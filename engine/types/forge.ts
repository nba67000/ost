// Types de Forgé et vagues de la horde.
// Voir GLOSSARY (Forgé) et RULES §7.

import type { AbordId, LieuId } from "./carte.js";

export type TypeForge = "souche" | "ecorcheur" | "belier" | "chien_de_fosse" | "muet";

export interface Vague {
  readonly lieu_id: LieuId;
  readonly abord_id: AbordId;
  readonly composition: Readonly<Record<TypeForge, number>>;
}
