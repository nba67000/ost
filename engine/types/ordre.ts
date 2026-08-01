// Ordre de commandement pour un lieu, verrouillé à H-1.
// DSL fermé pour les conditions de réserve : voir RULES §6.

import type { AbordId, LieuId } from "./carte.js";
import type { Posture } from "./garnison.js";

export type MetriqueDeclencheur = "effectif_restant_relatif";
export type Comparateur = "<" | "<=" | ">" | ">=";

export interface DeclencheurCondition {
  readonly abord_id: AbordId;
  readonly metrique: MetriqueDeclencheur;
  readonly comparateur: Comparateur;
  /** Seuil relatif à l'effectif initial de l'abord au début de l'assaut. Dans [0, 1]. */
  readonly seuil: number;
}

export interface ActionCondition {
  readonly abord_cible: AbordId;
  /** Fraction de la réserve à engager. Dans [0, 1]. */
  readonly part_reserve: number;
}

export interface ConditionReserve {
  /** Ordre d'écriture — sert de priorité en cas de déclenchements simultanés. */
  readonly ordre: number;
  readonly declencheur: DeclencheurCondition;
  readonly action: ActionCondition;
}

export interface RepartitionAbord {
  readonly abord_id: AbordId;
  readonly effectif: number;
  readonly posture: Posture;
}

export interface Ordre {
  readonly lieu_id: LieuId;
  readonly repartition: readonly RepartitionAbord[];
  readonly conditions_reserve: readonly ConditionReserve[];
  /** Instant du verrouillage, ms epoch. Toujours passé en paramètre — jamais lu par /engine. */
  readonly verrouille_le: number;
}
