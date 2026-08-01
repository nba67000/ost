// Résolution d'UN round de combat, fonction pure.
// Implémente strictement RULES §6, dans l'ordre :
//   1. Instantané des abords
//   2. Calcul des forces (avec malus de flanc HÉRITÉ du round précédent)
//   3. Calcul des pertes (proportionnel simultané, à partir de l'instantané)
//   4. Application simultanée
//   5. Ruptures (seuil relatif à l'effectif initial de l'ASSAUT)
//   6. Marquage flanque pour le round suivant
//   7. Réserve (dernière, saut si le lieu tombe)
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
  /** Effectif au tout début de l'assaut (round 1). Sert au seuil de rupture. */
  readonly effectif_initial_assaut: number;
  readonly posture: Posture;
  /** Voisins directs dans l'anneau. Vide pour un poste avancé. */
  readonly voisins: readonly AbordId[];
  readonly fortification_niveau: number;
  /** Multiplicateur du terrain sur la fortification (crete=1.2, sinon 1). */
  readonly terrain_fortification: number;
  /** [0.6, 1.0] — voir engine/ravitaillement. */
  readonly ravitaillement_coef: number;
  /** 1.0 ou combat.modificateurs.fatigue_combat_veille (0.85). */
  readonly fatigue_coef: number;
  /** Usure moyenne des pièces engagées ; le plancher est appliqué dans la formule. */
  readonly usure_coef: number;
  /** 1.0 ou temps.bonus_preparation_verrouillage_matinal (1.15). */
  readonly preparation_coef: number;
  /** Grade du commandant du lieu (donne coordination). */
  readonly commandant_grade: Grade;
  /** Abord déjà rompu (round précédent). Ne combat plus. */
  readonly rompu: boolean;
  /** True si un voisin s'est rompu au round précédent. Malus s'applique CE round. */
  readonly flanque_ce_round: boolean;
}

export interface EtatReserve {
  readonly effectif: number;
  readonly effectif_initial_assaut: number;
  readonly commandant_grade: Grade;
}

export interface EtatRound {
  readonly lieu_id: LieuId;
  /** 1-based. Round courant, avant résolution. */
  readonly numero_round: number;
  readonly abords: readonly EtatAbord[];
  readonly reserve: EtatReserve;
}

export interface EntreeRound {
  readonly etat: EtatRound;
  /** Composition de la vague par abord attaqué. Absent = pas d'attaque cet round. */
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
  readonly pertes_defenseur: number;
  readonly pertes_assaillant: number;
  /** True si l'abord vient de céder à ce round (nouveau rompu). */
  readonly rupture: boolean;
  /** True si le malus de flanc s'appliquait à ce round. */
  readonly flanque_ce_round: boolean;
  /** True si l'abord est cédé sans combat (garnison nulle). */
  readonly cede_sans_combat: boolean;
}

export interface EngagementReserve {
  readonly condition_ordre: number;
  readonly abord_cible: AbordId;
  readonly effectif_engage: number;
}

export interface JournalRound {
  readonly numero_round: number;
  readonly details_abords: readonly DetailAbordRound[];
  readonly engagements_reserve: readonly EngagementReserve[];
  /** True si tous les abords sont désormais rompus : le lieu tombe. */
  readonly lieu_tombe: boolean;
}

export interface SortieRound {
  readonly etat_apres: EtatRound;
  readonly journal: JournalRound;
}

// --- Types utilitaires -----------------------------------------------------

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

  // Étape 1 : instantané pris ici. `snapshot` sert de source à TOUT le
  // calcul des forces et des pertes de ce round — aucune application n'est
  // faite avant d'avoir tout calculé.
  const snapshot = etat.abords;

  // Étapes 2 & 3 : forces + pertes par abord, sur l'instantané.
  const details: DetailAbordRound[] = snapshot.map((abord) =>
    resoudreAbord(abord, vagues.get(abord.abord_id), config),
  );

  // Étape 4 (implicite) : les nouveaux effectifs viennent directement de
  // details[i].effectif_apres — calculés en parallèle, appliqués en même temps.

  // Étape 5 : ruptures nouvelles à ce round (pas déjà rompus).
  const nouvellesRuptures = new Set<AbordId>();
  for (const d of details) {
    if (d.rupture) nouvellesRuptures.add(d.abord_id);
  }

  // Étape 6 : marquage flanque pour le prochain round. Un abord survivant
  // dont un voisin a rompu CE round subira le malus au round suivant.
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

  // Assemblage des abords post-pertes.
  const abordsApres: EtatAbord[] = snapshot.map((a) => {
    const d = details.find((x) => x.abord_id === a.abord_id)!;
    return {
      ...a,
      effectif: d.effectif_apres,
      rompu: a.rompu || d.rupture,
      flanque_ce_round: flanquePourProchain.has(a.abord_id),
    };
  });

  const lieu_tombe = abordsApres.every((a) => a.rompu);

  // Étape 7 : réserve. Skip si le lieu tombe — la réserve n'a pas le temps
  // d'agir (RULES §6, cas limite documenté).
  let reserveApres = etat.reserve;
  const engagements: EngagementReserve[] = [];

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
      if (cible.rompu) continue; // cible perdue

      const cibleEngagement = Math.floor(
        condition.action.part_reserve * reserveApres.effectif_initial_assaut,
      );
      const engage = Math.min(cibleEngagement, reserveApres.effectif);
      if (engage <= 0) continue;

      abordsApres[cibleIdx] = { ...cible, effectif: cible.effectif + engage };
      reserveApres = { ...reserveApres, effectif: reserveApres.effectif - engage };
      engagements.push({
        condition_ordre: condition.ordre,
        abord_cible: condition.action.abord_cible,
        effectif_engage: engage,
      });
    }
  }

  return {
    etat_apres: {
      lieu_id: etat.lieu_id,
      numero_round: etat.numero_round + 1,
      abords: abordsApres,
      reserve: reserveApres,
    },
    journal: {
      numero_round: etat.numero_round,
      details_abords: details,
      engagements_reserve: engagements,
      lieu_tombe,
    },
  };
}

// --- Résolution d'un abord (étapes 2 + 3 pour ce paquet) -------------------

function resoudreAbord(
  abord: EtatAbord,
  composition: Readonly<Record<TypeForge, number>> | undefined,
  config: Balance,
): DetailAbordRound {
  // Abord déjà rompu : n'entre plus dans le combat.
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

  // Pas d'assaut sur cet abord.
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

  // Abord sans garnison : cède immédiatement, sans passer par la matrice.
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

  const F_d_raw = abord.effectif * coef_posture * modifiers * flanque_factor;
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

// --- Helpers de calcul -----------------------------------------------------

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
