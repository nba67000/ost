// Résolution d'UN round de combat, fonction pure.
// Implémente strictement RULES §6, dans l'ordre :
//   1. Instantané des abords
//   2. Calcul des forces (avec malus de flanc HÉRITÉ du round précédent
//      et malus d'engagement de réserve HÉRITÉ)
//   3. Calcul des pertes (proportionnel simultané, à partir de l'instantané)
//      - Pertes des abords (par leur vague)
//      - Pertes de l'intérieur (par l'intrusion des vagues d'abords rompus)
//   4. Application simultanée
//   5. Ruptures (seuil relatif à l'effectif initial de l'ASSAUT)
//   6. Marquage flanque pour le round suivant
//   7. Réserve (dernière, saut si le lieu tombe)
//      - Marque reserve_recente sur l'abord engagé pour malus au round suivant
//
// L'appelant boucle sur les rounds pour un assaut complet.

import type { Balance } from "../../config/schema.js";
import { puissanceEntiere } from "../math/index.js";
import type { AbordId, LieuId } from "../types/carte.js";
import type { TypeForge } from "../types/forge.js";
import type { Posture } from "../types/garnison.js";
import type { Grade } from "../types/grade.js";
import type { ConditionReserve } from "../types/ordre.js";

// --- Entrées ---------------------------------------------------------------

export interface EtatAbord {
  readonly abord_id: AbordId;
  readonly effectif: number;
  readonly effectif_initial_assaut: number;
  readonly posture: Posture;
  readonly voisins: readonly AbordId[];
  readonly fortification_niveau: number;
  readonly terrain_fortification: number;
  readonly ravitaillement_coef: number;
  readonly fatigue_coef: number;
  readonly usure_coef: number;
  readonly preparation_coef: number;
  readonly commandant_grade: Grade;
  readonly rompu: boolean;
  /** True si un voisin s'est rompu au round précédent. Malus s'applique CE round. */
  readonly flanque_ce_round: boolean;
  /** True si la réserve a été engagée SUR CET ABORD au round précédent.
   *  Malus de désordre s'applique CE round, puis se dissipe. */
  readonly reserve_recente: boolean;
}

export interface EtatReserve {
  readonly effectif: number;
  readonly effectif_initial_assaut: number;
  readonly commandant_grade: Grade;
}

export interface EtatRound {
  readonly lieu_id: LieuId;
  readonly numero_round: number;
  readonly abords: readonly EtatAbord[];
  readonly reserve: EtatReserve;
}

export interface EntreeRound {
  readonly etat: EtatRound;
  readonly vagues: ReadonlyMap<AbordId, Readonly<Record<TypeForge, number>>>;
  readonly conditions_reserve: readonly ConditionReserve[];
  readonly config: Balance;
}

// --- Sorties ---------------------------------------------------------------

export interface DetailAbordRound {
  readonly abord_id: AbordId;
  readonly effectif_avant: number;
  readonly effectif_apres: number;
  readonly force_defenseur: number;
  readonly force_assaillant: number;
  readonly coef_posture: number;
  /** Pertes défenseur TOTALES (combat abord + spillover intérieur). */
  readonly pertes_defenseur: number;
  /** Pertes défenseur venant du combat intérieur (spillover après réserve épuisée). */
  readonly pertes_defenseur_interior: number;
  readonly pertes_assaillant: number;
  readonly rupture: boolean;
  readonly flanque_ce_round: boolean;
  readonly cede_sans_combat: boolean;
}

export interface EngagementReserve {
  readonly condition_ordre: number;
  readonly abord_cible: AbordId;
  readonly effectif_engage: number;
}

/** Détail du combat intérieur (brèche), ou null si aucune intrusion ce round. */
export interface DetailInterior {
  readonly F_intrusion: number;
  readonly F_interior: number;
  readonly pertes_intrusion: number;
  readonly pertes_reserve: number;
  readonly pertes_abords_par_id: Readonly<Record<string, number>>;
  readonly composition_intrusion: Readonly<Record<TypeForge, number>>;
}

export interface JournalRound {
  readonly numero_round: number;
  readonly details_abords: readonly DetailAbordRound[];
  readonly engagements_reserve: readonly EngagementReserve[];
  readonly interior: DetailInterior | null;
  /** True si tous les abords sont désormais rompus : le lieu tombe. */
  readonly lieu_tombe: boolean;
}

export interface SortieRound {
  readonly etat_apres: EtatRound;
  readonly journal: JournalRound;
}

// --- Constantes ------------------------------------------------------------

const TYPES_FORGES: readonly TypeForge[] = [
  "souche",
  "ecorcheur",
  "belier",
  "chien_de_fosse",
  "muet",
];

// --- Fonction principale ---------------------------------------------------

export function resoudreRound(entree: EntreeRound): SortieRound {
  const { etat, vagues, conditions_reserve, config } = entree;
  const snapshot = etat.abords;

  // Étapes 2 & 3a : combats d'abord (non-rompus, à partir de l'instantané).
  const detailsAbords: DetailAbordRoundPartial[] = snapshot.map((abord) =>
    resoudreAbord(abord, vagues.get(abord.abord_id), config),
  );

  // Étape 3b : intrusion (brèche). Vagues visant des abords rompus au start.
  const intrusion: Record<TypeForge, number> = {
    souche: 0,
    ecorcheur: 0,
    belier: 0,
    chien_de_fosse: 0,
    muet: 0,
  };
  let F_intrusion = 0;
  for (const abord of snapshot) {
    if (!abord.rompu) continue;
    const w = vagues.get(abord.abord_id);
    if (w === undefined) continue;
    for (const t of TYPES_FORGES) {
      const n = w[t] ?? 0;
      intrusion[t] += n;
      F_intrusion += n;
    }
  }

  // Combat intérieur — sans fortification, sans posture, mais avec la
  // coordination du commandant de la réserve.
  let pertes_reserve_interior = 0;
  const pertes_abord_interior = new Map<AbordId, number>();
  let interiorDetail: DetailInterior | null = null;
  let pertes_intrusion = 0;
  const coordInterior = config.grades.coordination[etat.reserve.commandant_grade];

  if (F_intrusion > 0) {
    const nonRompus = snapshot.filter((a) => !a.rompu);
    const totalAbordEff = nonRompus.reduce((s, a) => s + a.effectif, 0);
    const interior_eff = etat.reserve.effectif + totalAbordEff;
    const F_interior = interior_eff * coordInterior;
    let pertes_int_def = 0;

    if (interior_eff > 0) {
      const total = F_interior + F_intrusion;
      const k = config.combat.taux_pertes_par_round;
      pertes_int_def = Math.floor(((k * F_intrusion) / total) * interior_eff);
      pertes_intrusion = Math.floor(((k * F_interior) / total) * F_intrusion);
      if (F_intrusion > 0 && pertes_int_def === 0) pertes_int_def = 1;
      if (F_interior > 0 && pertes_intrusion === 0) pertes_intrusion = 1;
      pertes_int_def = Math.min(pertes_int_def, interior_eff);
      pertes_intrusion = Math.min(pertes_intrusion, F_intrusion);

      // Distribution : réserve d'abord, puis abords au prorata.
      pertes_reserve_interior = Math.min(pertes_int_def, etat.reserve.effectif);
      let restant = pertes_int_def - pertes_reserve_interior;
      if (restant > 0 && totalAbordEff > 0) {
        for (const a of nonRompus) {
          const share = Math.round((restant * a.effectif) / totalAbordEff);
          pertes_abord_interior.set(a.abord_id, share);
        }
      }
    }

    interiorDetail = {
      F_intrusion,
      F_interior,
      pertes_intrusion,
      pertes_reserve: pertes_reserve_interior,
      pertes_abords_par_id: Object.fromEntries(pertes_abord_interior),
      composition_intrusion: intrusion,
    };
  }

  // Étape 4-5 : application des pertes (abord + intérieur) et évaluation des ruptures.
  const nouvellesRuptures = new Set<AbordId>();
  const abordsIntermed: EtatAbord[] = snapshot.map((a, i) => {
    const d = detailsAbords[i]!;
    let nouveau_effectif: number;
    let rupture: boolean;
    if (a.rompu) {
      nouveau_effectif = a.effectif;
      rupture = false;
    } else if (d.cede_sans_combat) {
      nouveau_effectif = 0;
      rupture = true;
    } else {
      const interior_p = pertes_abord_interior.get(a.abord_id) ?? 0;
      const total_pertes = d.pertes_defenseur + interior_p;
      nouveau_effectif = Math.max(0, a.effectif - total_pertes);
      const seuil = config.combat.seuil_rupture_abord * a.effectif_initial_assaut;
      rupture = nouveau_effectif < seuil;
    }
    if (rupture && !a.rompu) nouvellesRuptures.add(a.abord_id);
    return {
      ...a,
      effectif: nouveau_effectif,
      rompu: a.rompu || rupture,
      flanque_ce_round: false, // sera mis à jour ci-dessous
      reserve_recente: false, // reset — sera mis à jour à l'étape 7 si engagement ce round
    };
  });

  // Détails finaux : incorpore les pertes intérieures dans pertes_defenseur.
  const detailsFinals: DetailAbordRound[] = detailsAbords.map((d, i) => {
    const a = snapshot[i]!;
    const interior_p = pertes_abord_interior.get(a.abord_id) ?? 0;
    const total_pertes = d.pertes_defenseur + interior_p;
    const nouveau_eff = abordsIntermed[i]!.effectif;
    const rupture =
      !a.rompu &&
      (a.effectif === 0
        ? d.cede_sans_combat
        : nouveau_eff < config.combat.seuil_rupture_abord * a.effectif_initial_assaut);
    return {
      ...d,
      pertes_defenseur: total_pertes,
      pertes_defenseur_interior: interior_p,
      effectif_apres: nouveau_eff,
      rupture,
    };
  });

  // Étape 6 : marquage flanque pour le prochain round.
  const flanquePourProchain = new Set<AbordId>();
  for (const abord of snapshot) {
    if (abord.rompu) continue;
    if (nouvellesRuptures.has(abord.abord_id)) continue;
    for (const v of abord.voisins) {
      if (nouvellesRuptures.has(v)) {
        flanquePourProchain.add(abord.abord_id);
        break;
      }
    }
  }

  // Applique flanque à abordsIntermed.
  const abordsApres = abordsIntermed.map((a) => ({
    ...a,
    flanque_ce_round: flanquePourProchain.has(a.abord_id),
  }));

  // Lieu tombe : condition classique (tous rompus).
  let lieu_tombe = abordsApres.every((a) => a.rompu);

  // Réserve après le combat intérieur.
  let reserveApres = {
    ...etat.reserve,
    effectif: Math.max(0, etat.reserve.effectif - pertes_reserve_interior),
  };

  // RUPTURE DU LIEU par effondrement de l'intérieur (RULES §6).
  // Si l'intérieur a été engagé ce round et que sa force effective ne
  // suffit plus à contenir l'intrusion survivante, le lieu tombe même
  // si un abord tient encore.
  if (!lieu_tombe && F_intrusion > 0) {
    const surviving_intrusion = F_intrusion - pertes_intrusion;
    if (surviving_intrusion > 0) {
      let interior_apres_eff = reserveApres.effectif;
      for (const a of abordsApres) {
        if (!a.rompu) interior_apres_eff += a.effectif;
      }
      const F_interior_apres = interior_apres_eff * coordInterior;
      if (F_interior_apres < config.combat.seuil_effondrement * surviving_intrusion) {
        lieu_tombe = true;
      }
    }
  }

  // Étape 7 : réserve (skip si lieu tombe).
  const engagements: EngagementReserve[] = [];
  const abordsRecents = new Set<AbordId>();

  if (!lieu_tombe) {
    const conditionsTriees = [...conditions_reserve].sort((a, b) => a.ordre - b.ordre);
    for (const condition of conditionsTriees) {
      if (reserveApres.effectif <= 0) break;

      const abordDecl = abordsApres.find((a) => a.abord_id === condition.declencheur.abord_id);
      if (abordDecl === undefined) continue;

      const ratio =
        abordDecl.effectif_initial_assaut > 0
          ? abordDecl.effectif / abordDecl.effectif_initial_assaut
          : 0;
      if (
        !evaluerDeclencheur(ratio, condition.declencheur.comparateur, condition.declencheur.seuil)
      ) {
        continue;
      }

      const cibleIdx = abordsApres.findIndex((a) => a.abord_id === condition.action.abord_cible);
      if (cibleIdx === -1) continue;
      const cible = abordsApres[cibleIdx]!;
      if (cible.rompu) continue;

      const cibleEngagement = Math.floor(
        condition.action.part_reserve * reserveApres.effectif_initial_assaut,
      );
      const engage = Math.min(cibleEngagement, reserveApres.effectif);
      if (engage <= 0) continue;

      abordsApres[cibleIdx] = { ...cible, effectif: cible.effectif + engage };
      abordsRecents.add(condition.action.abord_cible);
      reserveApres = { ...reserveApres, effectif: reserveApres.effectif - engage };
      engagements.push({
        condition_ordre: condition.ordre,
        abord_cible: condition.action.abord_cible,
        effectif_engage: engage,
      });
    }
  }

  // Marque reserve_recente sur les abords ayant reçu un engagement.
  const abordsFinaux = abordsApres.map((a) => ({
    ...a,
    reserve_recente: abordsRecents.has(a.abord_id),
  }));

  return {
    etat_apres: {
      lieu_id: etat.lieu_id,
      numero_round: etat.numero_round + 1,
      abords: abordsFinaux,
      reserve: reserveApres,
    },
    journal: {
      numero_round: etat.numero_round,
      details_abords: detailsFinals,
      engagements_reserve: engagements,
      interior: interiorDetail,
      lieu_tombe,
    },
  };
}

// --- Résolution d'un abord (partial, sans pertes intérieures) --------------

type DetailAbordRoundPartial = Omit<
  DetailAbordRound,
  "pertes_defenseur_interior" | "pertes_defenseur"
> & { readonly pertes_defenseur: number };

function resoudreAbord(
  abord: EtatAbord,
  composition: Readonly<Record<TypeForge, number>> | undefined,
  config: Balance,
): DetailAbordRoundPartial {
  if (abord.rompu) {
    return {
      abord_id: abord.abord_id,
      effectif_avant: abord.effectif,
      effectif_apres: abord.effectif,
      force_defenseur: 0,
      force_assaillant: 0,
      coef_posture: 0,
      pertes_defenseur: 0,
      pertes_assaillant: 0,
      rupture: false,
      flanque_ce_round: false,
      cede_sans_combat: false,
    };
  }

  if (composition === undefined) {
    return {
      abord_id: abord.abord_id,
      effectif_avant: abord.effectif,
      effectif_apres: abord.effectif,
      force_defenseur: 0,
      force_assaillant: 0,
      coef_posture: 0,
      pertes_defenseur: 0,
      pertes_assaillant: 0,
      rupture: false,
      flanque_ce_round: abord.flanque_ce_round,
      cede_sans_combat: false,
    };
  }

  const F_a = sommeComposition(composition);

  if (abord.effectif <= 0) {
    return {
      abord_id: abord.abord_id,
      effectif_avant: 0,
      effectif_apres: 0,
      force_defenseur: 0,
      force_assaillant: F_a,
      coef_posture: 0,
      pertes_defenseur: 0,
      pertes_assaillant: 0,
      rupture: true,
      flanque_ce_round: abord.flanque_ce_round,
      cede_sans_combat: true,
    };
  }

  const coef_posture = calcCoefPosture(abord.posture, composition, config);
  const modifiers = calcModifiers(abord, config);
  const flanque_factor = abord.flanque_ce_round ? config.combat.malus_flanc_apres_rupture : 1;
  const engagement_factor = abord.reserve_recente ? config.combat.malus_engagement_reserve : 1;

  const F_d_raw = abord.effectif * coef_posture * modifiers * flanque_factor * engagement_factor;
  const F_d = clamp(
    F_d_raw,
    config.combat.clamp_force_min * abord.effectif,
    config.combat.clamp_force_max * abord.effectif,
  );

  const k = config.combat.taux_pertes_par_round;
  const total = F_d + F_a;
  let pertes_d = 0;
  let pertes_a = 0;
  if (total > 0) {
    pertes_d = Math.floor(((k * F_a) / total) * abord.effectif);
    pertes_a = Math.floor(((k * F_d) / total) * F_a);
    if (F_a > 0 && pertes_d === 0) pertes_d = 1;
    if (F_d > 0 && pertes_a === 0) pertes_a = 1;
  }
  pertes_d = Math.min(pertes_d, abord.effectif);
  pertes_a = Math.min(pertes_a, F_a);

  const nouveau = abord.effectif - pertes_d;
  const seuil = config.combat.seuil_rupture_abord * abord.effectif_initial_assaut;
  const rupture = nouveau < seuil;

  return {
    abord_id: abord.abord_id,
    effectif_avant: abord.effectif,
    effectif_apres: nouveau,
    force_defenseur: F_d,
    force_assaillant: F_a,
    coef_posture,
    pertes_defenseur: pertes_d,
    pertes_assaillant: pertes_a,
    rupture,
    flanque_ce_round: abord.flanque_ce_round,
    cede_sans_combat: false,
  };
}

// --- Helpers ---------------------------------------------------------------

function calcCoefPosture(
  posture: Posture,
  composition: Readonly<Record<TypeForge, number>>,
  config: Balance,
): number {
  if (posture === "reserve") {
    throw new Error("combat/round : un abord ne peut pas avoir la posture 'reserve'");
  }
  const total = sommeComposition(composition);
  if (total === 0) return 0;
  const row = config.combat.matrice_posture[posture];
  if (row === undefined) {
    throw new Error(`combat/round : posture inconnue dans la matrice : ${String(posture)}`);
  }
  let coef = 0;
  for (const type of TYPES_FORGES) {
    const count = composition[type] ?? 0;
    if (count === 0) continue;
    const cellCoef = row[type];
    if (cellCoef === undefined) {
      throw new Error(`combat/round : type absent de la matrice[${posture}] : ${type}`);
    }
    coef += (count / total) * cellCoef;
  }
  return coef;
}

function calcModifiers(abord: EtatAbord, config: Balance): number {
  const fortifBase = config.combat.modificateurs.fortification_par_niveau;
  const fortifTerme =
    puissanceEntiere(fortifBase, abord.fortification_niveau) * abord.terrain_fortification;
  const usurePlancher = config.combat.modificateurs.usure_equipement_min;
  const usureEffective = Math.max(abord.usure_coef, usurePlancher);
  const coordination = config.grades.coordination[abord.commandant_grade];
  return (
    fortifTerme *
    abord.ravitaillement_coef *
    abord.fatigue_coef *
    usureEffective *
    coordination *
    abord.preparation_coef
  );
}

function sommeComposition(comp: Readonly<Record<TypeForge, number>>): number {
  let total = 0;
  for (const type of TYPES_FORGES) total += comp[type] ?? 0;
  return total;
}

function evaluerDeclencheur(ratio: number, comparateur: string, seuil: number): boolean {
  switch (comparateur) {
    case "<":
      return ratio < seuil;
    case "<=":
      return ratio <= seuil;
    case ">":
      return ratio > seuil;
    case ">=":
      return ratio >= seuil;
    default:
      return false;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
