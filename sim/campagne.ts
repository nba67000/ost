// Exécute une campagne complète : génération de la carte, placement initial,
// enchaînement de 30 jours, arrêt anticipé à la chute.

import type { Balance } from "../config/schema.js";
import type { EtatCampagne, EtatJoueur, RapportJour } from "../engine/types/campagne.js";
import type { JoueurId } from "../engine/types/garnison.js";
import type { Population } from "./populations/index.js";
import type { NomPolitique, Politique } from "./politiques/types.js";
import type { OrdreJoueur } from "../engine/types/campagne.js";
import type { LieuId } from "../engine/types/carte.js";
import { POLITIQUES } from "./politiques/index.js";
import { placementInitial, placementInitialSurExposes } from "./placement.js";
import { avancerJour, metriquesVides } from "../engine/jour/index.js";
import { genererCarte } from "../engine/carte/generation.js";
import { tirerDoctrinesLune } from "../engine/horde/doctrines/index.js";
import { creerRng } from "../engine/rng/index.js";
import type { ProvinceId } from "../engine/types/carte.js";

export interface OptionsCampagne {
  readonly graine: bigint;
  readonly population: Population;
  readonly puissance_varhal: number;
  readonly duree_jours: number;
  readonly config: Balance;
  /**
   * Placement au J0 :
   * - "grade"    (défaut) : distribution par grade sur PF/feux/postes.
   * - "exposes"           : greedy sur les abords des lieux exposés, poids
   *   goulot × part_goulot. Sert à comparer équitablement des politiques
   *   qui n'ont pas le luxe du redéploiement instantané.
   */
  readonly placement_initial?: "grade" | "exposes";
}

export interface ResultatCampagne {
  readonly etat_final: EtatCampagne;
  readonly rapports: readonly RapportJour[];
  readonly province_est_tombee: boolean;
}

export function executerCampagne(opts: OptionsCampagne): ResultatCampagne {
  const rng = creerRng(opts.graine);
  // 1. Générer la carte (via engine/carte/generation).
  const cartePop = compterCapaciteInitiale(opts.population, opts.config);
  const carte = genererCarte({
    graine: rng.suivant(),
    effectif_actif: cartePop,
    province_id: "PROV-1" as ProvinceId,
    province_perdue_id: null,
    config: opts.config,
  });
  const province = carte.province;

  // 2. Créer les joueurs à partir de la population.
  const joueurs = new Map<JoueurId, EtatJoueur>();
  const politiqueParJoueur = new Map<JoueurId, NomPolitique>();
  let compteur = 0;
  for (const spec of opts.population.joueurs) {
    for (let i = 0; i < spec.quantite; i++) {
      const id = `J${String(++compteur).padStart(4, "0")}` as JoueurId;
      joueurs.set(id, {
        id,
        grade: spec.grade,
        usure_restante: opts.config.economie.usure_batailles_neuf,
        blessure: null,
        transit: null,
      });
      politiqueParJoueur.set(id, spec.politique);
    }
  }

  // 3. Placement initial.
  const garnisonsInitiales =
    opts.placement_initial === "exposes"
      ? placementInitialSurExposes(province, joueurs, opts.config)
      : placementInitial(province, joueurs, opts.config);

  // 4. Vivres initiaux = capacité maximale par nature.
  const vivres = new Map<LieuId, number>();
  const capMax = opts.config.ravitaillement.capacite_max;
  for (const l of province.lieux) {
    if (l.nature === "place_forte") vivres.set(l.id, capMax.place_forte);
    else if (l.nature === "feu_de_guet") vivres.set(l.id, capMax.feu_de_guet);
    else if (l.nature === "poste_avance") vivres.set(l.id, capMax.poste_avance);
    else vivres.set(l.id, 0);
  }

  // 5. Doctrines actives de la lune.
  const doctrines = tirerDoctrinesLune(opts.graine, opts.config);

  let etat: EtatCampagne = {
    jour: 0,
    graine_lune: opts.graine,
    province,
    garnisons: garnisonsInitiales,
    vivres,
    joueurs,
    puissance_varhal: opts.puissance_varhal,
    doctrines_actives: doctrines,
    metriques: metriquesVides(province.lieux.filter((l) => l.tenu_par === "royaume").length),
  };

  const rapports: RapportJour[] = [];

  for (let jour = 1; jour <= opts.duree_jours; jour++) {
    // Regrouper les joueurs par politique.
    const parPolitique = new Map<NomPolitique, JoueurId[]>();
    for (const [jid, nom] of politiqueParJoueur) {
      const arr = parPolitique.get(nom) ?? [];
      arr.push(jid);
      parPolitique.set(nom, arr);
    }
    // Appeler chaque politique, fusionner les ordres.
    const ordres = new Map<JoueurId, OrdreJoueur>();
    for (const [nom, mes] of parPolitique) {
      const pol: Politique = POLITIQUES[nom];
      const sous = pol({ etat, mes_joueurs: mes, jour, config: opts.config });
      for (const [k, v] of sous) ordres.set(k, v);
    }
    // Avancer un jour.
    const { etat_suivant, rapport } = avancerJour({ etat, ordres, config: opts.config });
    rapports.push(rapport);
    etat = etat_suivant;
    if (etat.metriques.jour_chute !== null) break;
  }

  return {
    etat_final: etat,
    rapports,
    province_est_tombee: etat.metriques.jour_chute !== null,
  };
}

// --- Helpers ---------------------------------------------------------------

function compterCapaciteInitiale(pop: Population, config: Balance): number {
  let s = 0;
  for (const spec of pop.joueurs) {
    s += spec.quantite * config.grades.effectif_commande[spec.grade];
  }
  return s;
}
