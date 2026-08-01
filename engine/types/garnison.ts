// Types de garnison et de posture.
// Voir RULES §6 (Combat) et GLOSSARY (Posture, Réserve).

import type { AbordId, LieuId } from "./carte.js";

export type Posture = "mur" | "cognee" | "fer" | "reserve";

declare const JoueurIdBrand: unique symbol;
export type JoueurId = string & { readonly [JoueurIdBrand]: never };

/** Un paquet de garnison affecté à un abord précis, avec sa posture. */
export interface PaquetGarnison {
  readonly abord_id: AbordId;
  readonly joueurs: readonly JoueurId[];
  readonly effectif: number;
  readonly posture: Posture;
}

/** La garnison complète d'un lieu, éclatée en paquets par abord + réserve non affectée. */
export interface Garnison {
  readonly lieu_id: LieuId;
  readonly paquets: readonly PaquetGarnison[];
  readonly reserve: readonly JoueurId[];
}
