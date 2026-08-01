// Un pas de simulation complet — RULES §2 rythme du jour.
//
// Séquence :
//   1. Appliquer les ordres → nouvelles garnisons
//   2. Calculer nb_fronts + volume (paramètres de la horde)
//   3. Planifier la horde (orchestrerJour)
//   4. Résoudre chaque assaut (resoudreAssaut)
//   5. Appliquer les conséquences : pertes, blessures, usure, chutes de lieu
//   6. Ravitaillement du jour (calculerApprovisionnement + appliquerJour)
//   7. Retours à deux horloges : apte au combat (retour_combat_jour) et
//      sortie du centre (fin_presence_centre_jour). Un joueur peut être
//      apte au combat et encore inscrit à la cour d'entraînement.
//   8. Snapshot des métriques
//
// Fonction pure : reçoit l'état, retourne le suivant. Aucune I/O.

import type { Balance } from "../../config/schema.js";
import type { LieuId, Lieu, Province, AbordId } from "../types/carte.js";
import type { Garnison, JoueurId, PaquetGarnison } from "../types/garnison.js";
import type {
  EtatCampagne,
  EtatJoueur,
  MetriquesCampagne,
  OrdreJoueur,
  RapportJour,
} from "../types/campagne.js";
import type { NomDoctrine } from "../horde/doctrines/index.js";
import { orchestrerJour } from "../horde/orchestrer.js";
import { calculerNbFronts } from "../horde/fronts.js";
import { calculerVolume } from "../horde/volume.js";
import {
  calculerApprovisionnement,
  appliquerJour as appliquerRavitaillement,
} from "../ravitaillement/index.js";
import { resoudreAssaut, type SortieAssaut } from "../combat/assaut.js";
import { appliquerOrdres } from "./ordres.js";
import { construireEtatRound, vaguesParRound, effectifJoueur } from "./adapter.js";
import { calculerConsequences } from "./consequences.js";

export interface EntreeJour {
  readonly etat: EtatCampagne;
  readonly ordres: ReadonlyMap<JoueurId, OrdreJoueur>;
  readonly config: Balance;
}

export interface SortieJour {
  readonly etat_suivant: EtatCampagne;
  readonly rapport: RapportJour;
}

/**
 * Fabrique un état vide de métriques. Le caller doit remplir
 * `lieux_royaume_initial` (nb de lieux royaume avant J1) — c'est la
 * référence pour calculer le délai « 1ère perte → moitié de province ».
 */
export function metriquesVides(lieux_royaume_initial = 0): MetriquesCampagne {
  return {
    premier_choix_par_doctrine: {
      marteau: { premier_choix_obtenus: 0, draft_tours: 0 },
      ecorcheurs: { premier_choix_obtenus: 0, draft_tours: 0 },
      meute: { premier_choix_obtenus: 0, draft_tours: 0 },
      rouleau: { premier_choix_obtenus: 0, draft_tours: 0 },
      garde: { premier_choix_obtenus: 0, draft_tours: 0 },
      serpent: { premier_choix_obtenus: 0, draft_tours: 0 },
    },
    blessures_totales: { legere: 0, serieuse: 0, grave: 0 },
    usure_consommee: 0,
    equipements_detruits: 0,
    blesses_au_centre_par_jour: [],
    couverture_par_jour: [],
    lieux_royaume_par_jour: [],
    volume_par_jour: [],
    nb_fronts_par_jour: [],
    effectif_defensif_moyen_par_front_par_jour: [],
    chutes: [],
    lieux_royaume_initial,
    jour_chute: null,
  };
}

export function avancerJour(entree: EntreeJour): SortieJour {
  const { etat, ordres, config } = entree;
  const jourResolu = etat.jour + 1;

  // 0. Arrivées de transit (RULES §4). Les joueurs dont arrivee_jour ≤
  //    jourResolu tombent en réserve du lieu de destination si celui-ci
  //    est encore tenu. Sinon, ils restent hors carte pour la journée —
  //    la destination a chuté pendant leur marche.
  let joueursCourants = new Map(etat.joueurs);
  const garnisonsAvecArrivees = new Map<LieuId, Garnison>();
  for (const [lid, g] of etat.garnisons) {
    garnisonsAvecArrivees.set(lid, {
      lieu_id: g.lieu_id,
      paquets: [...g.paquets],
      reserve: [...g.reserve],
    });
  }
  const lieuxRoyaumeSet = new Set(
    etat.province.lieux.filter((l) => l.tenu_par === "royaume").map((l) => l.id),
  );
  for (const [jid, j] of joueursCourants) {
    if (j.transit === null) continue;
    if (j.transit.arrivee_jour > jourResolu) continue;
    if (lieuxRoyaumeSet.has(j.transit.destination_lieu_id)) {
      const g = garnisonsAvecArrivees.get(j.transit.destination_lieu_id);
      if (g !== undefined) {
        (g.reserve as JoueurId[]).push(jid);
      }
    }
    joueursCourants.set(jid, { ...j, transit: null });
  }

  // 1. Ordres → nouvelles garnisons + nouveaux transits.
  const sortieOrdres = appliquerOrdres(
    garnisonsAvecArrivees,
    ordres,
    joueursCourants,
    etat.province,
    config,
    jourResolu,
  );
  const garnisonsApresOrdres = sortieOrdres.garnisons;
  for (const [jid, t] of sortieOrdres.nouveaux_transits) {
    const j = joueursCourants.get(jid);
    if (j === undefined) continue;
    joueursCourants.set(jid, { ...j, transit: t });
  }

  // 2. Paramètres horde. `capacite` et `effectif_total_royaume` sont ici la
  // même quantité : Σ effectif_commande des joueurs actifs. Le volume ne
  // dépend PAS de la garnison placée (règle du volume indépendant du choix
  // du joueur).
  const effectifTotal = calculerCapacite(etat.joueurs, config);
  const nbExposes = compterExposes(etat.province);
  const nbFronts = calculerNbFronts(effectifTotal, nbExposes, config);
  const productionFosses = productionCumuleeFosses(etat.province, config);
  const volumeTotal =
    nbFronts === 0
      ? 0
      : calculerVolume({
          production_cumulee_fosses: productionFosses,
          puissance_varhal: etat.puissance_varhal,
          effectif_total_royaume: effectifTotal,
          config,
        });

  // 3. Plan horde.
  const planHorde = orchestrerJour({
    jour: jourResolu,
    graine_lune: etat.graine_lune,
    province: etat.province,
    garnisons: garnisonsApresOrdres,
    volume_total: volumeTotal,
    nb_fronts: nbFronts,
    doctrines_actives: etat.doctrines_actives,
    config,
  });

  // 4-5. Combat + conséquences par lieu attaqué.
  const lieuParId = new Map<LieuId, Lieu>();
  for (const l of etat.province.lieux) lieuParId.set(l.id, l);

  const garnisonsFinales = new Map(garnisonsApresOrdres);
  const lieuxPerdus: LieuId[] = [];
  const rapportAssauts: {
    lieu_id: LieuId;
    doctrine: NomDoctrine;
    issue: import("../combat/assaut.js").IssueAssaut;
    rounds_utilises: number;
    pertes_defenseur: number;
    pertes_attaquant: number;
  }[] = [];
  const blessuresDuJour = { legere: 0, serieuse: 0, grave: 0 };
  let usureDuJour = 0;
  let equipementsDetruitsDuJour = 0;

  for (let i = 0; i < planHorde.vagues.length; i++) {
    const vague = planHorde.vagues[i]!;
    const doctrine = planHorde.doctrines_par_vague[i]!;
    const lieu = lieuParId.get(vague.lieu_id);
    if (lieu === undefined) continue;
    const garnison = garnisonsFinales.get(lieu.id);
    if (garnison === undefined) continue;

    const sortie = executerAssaut(lieu, garnison, vague, joueursCourants, config);
    rapportAssauts.push({
      lieu_id: lieu.id,
      doctrine,
      issue: sortie.issue,
      rounds_utilises: sortie.rounds_utilises,
      pertes_defenseur: sommePertesDefenseur(sortie),
      pertes_attaquant: sommePertesAttaquant(sortie),
    });

    const delta = calculerConsequences(lieu, garnison, sortie, joueursCourants, config);

    // Appliquer blessures : deux horloges INDÉPENDANTES, à l'HEURE.
    //   heure_blessure           = (jour − 1) × 24 + 21  (assaut à 21h civile)
    //   retour_combat_heure      = heure_blessure + inaptitude_heures
    //   fin_presence_centre_heure = heure_blessure + max(inaptitude, plancher_centre)
    // La discrétisation à l'heure évite l'effet ceil() qui faisait sortir
    // toutes les blessures d'un même jour ensemble.
    const heureBlessure = (jourResolu - 1) * 24 + 21;
    for (const [jid, info] of delta.nouvelles_blessures) {
      const j = joueursCourants.get(jid);
      if (j === undefined) continue;
      const dureeInapt = config.blessures.duree_heures[info.severite];
      const dureeCentre = Math.max(dureeInapt, config.blessures.duree_presence_centre_min_heures);
      joueursCourants.set(jid, {
        ...j,
        blessure: {
          severite: info.severite,
          retour_combat_heure: heureBlessure + dureeInapt,
          fin_presence_centre_heure: heureBlessure + dureeCentre,
        },
      });
      blessuresDuJour[info.severite]++;
    }

    // Appliquer usure : mettre à jour joueurs.
    for (const [jid, nouveau] of delta.usures_mises_a_jour) {
      const j = joueursCourants.get(jid);
      if (j === undefined) continue;
      usureDuJour += Math.max(0, j.usure_restante - nouveau);
      joueursCourants.set(jid, { ...j, usure_restante: nouveau });
    }
    equipementsDetruitsDuJour += delta.equipements_detruits_ids.length;

    // Retirer les blessés des paquets + décompter l'effectif.
    const paquetsMisAJour: PaquetGarnison[] = [];
    for (const p of garnison.paquets) {
      const joueursRestants = p.joueurs.filter((jid) => !delta.nouvelles_blessures.has(jid));
      const effRestant = joueursRestants.reduce((s, jid) => {
        const j = joueursCourants.get(jid);
        return s + (j === undefined ? 0 : effectifJoueur(j, config));
      }, 0);
      // On ajuste aussi l'effectif du paquet aux pertes matérielles (usure/désordre)
      // qui touchent la troupe sans blesser le joueur. Pour l'instant on ne les
      // retire pas — la simulation les compte via delta.pertes_par_abord si
      // besoin ultérieur.
      paquetsMisAJour.push({ ...p, joueurs: joueursRestants, effectif: effRestant });
    }
    garnisonsFinales.set(lieu.id, { ...garnison, paquets: paquetsMisAJour });

    if (sortie.issue === "lieu_tombe") lieuxPerdus.push(lieu.id);
  }

  // Marquer les lieux perdus : tenu_par ← "horde".
  const provinceApres = appliquerLieuxPerdus(etat.province, lieuxPerdus);

  // 6. Ravitaillement du jour.
  const assautsSet = new Set(planHorde.vagues.map((v) => v.lieu_id));
  const approv = calculerApprovisionnement(
    provinceApres.lieux,
    provinceApres.liens,
    provinceApres.place_forte_id,
    config,
  );
  const natures = new Map(provinceApres.lieux.map((l) => [l.id, l.nature]));
  const garnisonsEffectifs = new Map<LieuId, number>();
  for (const [lid, g] of garnisonsFinales) {
    let s = 0;
    for (const p of g.paquets) s += p.effectif;
    for (const jid of g.reserve) {
      const j = joueursCourants.get(jid);
      if (j !== undefined) s += effectifJoueur(j, config);
    }
    garnisonsEffectifs.set(lid, s);
  }
  const sortieRav = appliquerRavitaillement({
    vivres_par_lieu: etat.vivres,
    approvisionnes: approv.approvisionnes,
    recharge: approv.recharge,
    assauts_du_jour: assautsSet,
    natures,
    garnisons_effectif: garnisonsEffectifs,
    config,
  });

  // 7. Retours à deux horloges (heures). La blessure n'est effacée qu'à
  //    la sortie du centre (l'horloge la plus longue). Un joueur est HORS
  //    du centre à la fin du jour K si fin_presence_centre_heure ≤ K×24.
  const heureFinDuJour = jourResolu * 24;
  let retours = 0;
  for (const [jid, j] of joueursCourants) {
    if (j.blessure !== null && j.blessure.fin_presence_centre_heure <= heureFinDuJour) {
      joueursCourants.set(jid, { ...j, blessure: null });
      retours++;
    }
  }

  // 8. Métriques.
  const effectifDefensifMoyen =
    planHorde.vagues.length === 0
      ? 0
      : planHorde.vagues.reduce((s, v) => s + (garnisonsEffectifs.get(v.lieu_id) ?? 0), 0) /
        planHorde.vagues.length;
  const metriques = accumulerMetriques(
    etat.metriques,
    planHorde,
    blessuresDuJour,
    usureDuJour,
    equipementsDetruitsDuJour,
    joueursCourants, // après retours
    provinceApres,
    jourResolu,
    volumeTotal,
    nbFronts,
    effectifDefensifMoyen,
    lieuxPerdus,
    config,
  );

  return {
    etat_suivant: {
      jour: jourResolu,
      graine_lune: etat.graine_lune,
      province: provinceApres,
      garnisons: garnisonsFinales,
      vivres: sortieRav.vivres,
      joueurs: joueursCourants,
      puissance_varhal: etat.puissance_varhal,
      doctrines_actives: etat.doctrines_actives,
      metriques,
    },
    rapport: {
      jour: jourResolu,
      est_offensive: planHorde.est_offensive,
      assauts: rapportAssauts,
      lieux_perdus: lieuxPerdus,
      blesses_du_jour: blessuresDuJour.legere + blessuresDuJour.serieuse + blessuresDuJour.grave,
      usure_du_jour: usureDuJour,
      equipements_detruits_du_jour: equipementsDetruitsDuJour,
      retours_de_blessure: retours,
    },
  };
}

// --- Helpers ---------------------------------------------------------------

/**
 * `effectif_total_royaume` = Σ effectif_commande sur TOUS les joueurs
 * INSCRITS à la campagne, sans filtrer les blessés ni les en-transit.
 *
 * RULES §7 : le volume de la horde ne doit dépendre que de la taille de la
 * campagne, jamais de l'état momentané de la défense. Retirer les blessés
 * ferait chuter le volume à chaque défaite locale, ce qui viole la règle
 * « ne jamais s'adapter au succès (ou à l'échec) récent ». C'est la cause
 * racine de l'oscillation 450↔198 observée avec le concentrateur.
 */
function calculerCapacite(joueurs: ReadonlyMap<JoueurId, EtatJoueur>, config: Balance): number {
  let s = 0;
  for (const j of joueurs.values()) {
    s += config.grades.effectif_commande[j.grade];
  }
  return s;
}

function compterExposes(province: Province): number {
  const parId = new Map(province.lieux.map((l) => [l.id, l]));
  const entrees = new Set(province.entrees);
  const exposes = new Set<LieuId>();
  for (const id of entrees) {
    const l = parId.get(id);
    if (l !== undefined && l.tenu_par === "royaume") exposes.add(id);
  }
  for (const lien of province.liens) {
    const a = parId.get(lien.a);
    const b = parId.get(lien.b);
    if (a === undefined || b === undefined) continue;
    if (a.tenu_par === "royaume" && b.tenu_par === "horde") exposes.add(a.id);
    if (b.tenu_par === "royaume" && a.tenu_par === "horde") exposes.add(b.id);
  }
  return exposes.size;
}

function productionCumuleeFosses(province: Province, config: Balance): number {
  const nb = province.lieux.filter((l) => l.nature === "fosse" && l.tenu_par === "horde").length;
  return nb * config.horde.production_par_fosse_par_jour;
}

function executerAssaut(
  lieu: Lieu,
  garnison: Garnison,
  vague: import("../types/forge.js").Vague,
  joueurs: ReadonlyMap<JoueurId, EtatJoueur>,
  config: Balance,
): SortieAssaut {
  const etatInitial = construireEtatRound(lieu, garnison, joueurs, 1, config);
  const vagues = vaguesParRound(vague, config.combat.rounds_max);
  return resoudreAssaut({
    etat_initial: etatInitial,
    vagues_par_round: vagues,
    conditions_reserve: [],
    config,
  });
}

function sommePertesDefenseur(s: SortieAssaut): number {
  let n = 0;
  for (const r of s.rounds) for (const d of r.details_abords) n += d.pertes_defenseur;
  return n;
}

function sommePertesAttaquant(s: SortieAssaut): number {
  let n = 0;
  for (const r of s.rounds) for (const d of r.details_abords) n += d.pertes_assaillant;
  return n;
}

function appliquerLieuxPerdus(province: Province, perdus: readonly LieuId[]): Province {
  if (perdus.length === 0) return province;
  const set = new Set(perdus);
  const lieux = province.lieux.map((l) =>
    set.has(l.id) ? { ...l, tenu_par: "horde" as const } : l,
  );
  return { ...province, lieux };
}

function accumulerMetriques(
  precedentes: MetriquesCampagne,
  planHorde: import("../horde/orchestrer.js").SortieJourHorde,
  blessures: { legere: number; serieuse: number; grave: number },
  usure: number,
  equipements: number,
  joueursApresRetours: ReadonlyMap<JoueurId, EtatJoueur>,
  provinceApres: Province,
  jourResolu: number,
  volumeTotal: number,
  nbFronts: number,
  effectifDefensifMoyen: number,
  lieuxPerdus: readonly LieuId[],
  config: Balance,
): MetriquesCampagne {
  const nouveauxPremierChoix = { ...precedentes.premier_choix_par_doctrine };
  for (const pc of planHorde.premier_choix_par_doctrine) {
    const actuel = nouveauxPremierChoix[pc.doctrine];
    nouveauxPremierChoix[pc.doctrine] = {
      premier_choix_obtenus: actuel.premier_choix_obtenus + (pc.obtenu ? 1 : 0),
      draft_tours: actuel.draft_tours + 1,
    };
  }
  // Stock au centre : joueurs dont blessure existe encore APRÈS retours.
  let blessesAuCentre = 0;
  let recruesActives = 0;
  for (const j of joueursApresRetours.values()) {
    if (j.blessure !== null) blessesAuCentre++;
    if (j.grade === "recrue" && j.blessure === null) recruesActives++;
  }

  // Couverture du pilier de transmission.
  const placesDisponibles = blessesAuCentre * config.blessures.places_eleves_par_blesse;
  const couverture =
    recruesActives === 0 ? Number.POSITIVE_INFINITY : placesDisponibles / recruesActives;

  const lieuxRoyaume = provinceApres.lieux.filter((l) => l.tenu_par === "royaume").length;

  // Cause de chute — v1 : la seule cause productive dans le modèle actuel
  // est "assaut" (le lieu tombe par combat). "famine" et "isole" restent
  // possibles conceptuellement mais aucun mécanisme actuel ne les produit —
  // le diagnostic le confirme en attribuant zéro à ces catégories.
  const nouvellesChutes = lieuxPerdus.map((id) => ({
    lieu_id: id,
    jour: jourResolu,
    cause: "assaut" as const,
  }));

  const jourChute =
    precedentes.jour_chute !== null
      ? precedentes.jour_chute
      : provinceApres.lieux.find((l) => l.id === provinceApres.place_forte_id)?.tenu_par === "horde"
        ? jourResolu
        : null;

  return {
    premier_choix_par_doctrine: nouveauxPremierChoix,
    blessures_totales: {
      legere: precedentes.blessures_totales.legere + blessures.legere,
      serieuse: precedentes.blessures_totales.serieuse + blessures.serieuse,
      grave: precedentes.blessures_totales.grave + blessures.grave,
    },
    usure_consommee: precedentes.usure_consommee + usure,
    equipements_detruits: precedentes.equipements_detruits + equipements,
    blesses_au_centre_par_jour: [...precedentes.blesses_au_centre_par_jour, blessesAuCentre],
    couverture_par_jour: [...precedentes.couverture_par_jour, couverture],
    lieux_royaume_par_jour: [...precedentes.lieux_royaume_par_jour, lieuxRoyaume],
    volume_par_jour: [...precedentes.volume_par_jour, volumeTotal],
    nb_fronts_par_jour: [...precedentes.nb_fronts_par_jour, nbFronts],
    effectif_defensif_moyen_par_front_par_jour: [
      ...precedentes.effectif_defensif_moyen_par_front_par_jour,
      effectifDefensifMoyen,
    ],
    chutes: [...precedentes.chutes, ...nouvellesChutes],
    lieux_royaume_initial: precedentes.lieux_royaume_initial,
    jour_chute: jourChute,
  };
}

// Marqueur type unused pour éviter TS6133 sur AbordId réutilisé dans les types.
export type _unused = AbordId;
export type _u2 = NomDoctrine;
