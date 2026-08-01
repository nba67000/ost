// Ré-exports + tirage des doctrines actives de la lune.
// RULES §7 : `horde.doctrines_par_lune` (3) tirées parmi `doctrines_total`
// (6) à partir de la graine de la lune.

import { creerRng } from "../../rng/index.js";
import type { Balance } from "../../../config/schema.js";
import { NOMS_DOCTRINES, type Doctrine, type NomDoctrine } from "./types.js";
import { marteau } from "./marteau.js";
import { ecorcheurs } from "./ecorcheurs.js";
import { meute } from "./meute.js";
import { rouleau } from "./rouleau.js";
import { garde } from "./garde.js";
import { serpent } from "./serpent.js";

export const DOCTRINES: Readonly<Record<NomDoctrine, Doctrine>> = {
  marteau,
  ecorcheurs,
  meute,
  rouleau,
  garde,
  serpent,
};

export { NOMS_DOCTRINES } from "./types.js";
export type { Doctrine, NomDoctrine, Composition, CtxCiblage } from "./types.js";

/**
 * Tire les doctrines actives d'une lune. Ordre déterministe : la première
 * tirée est le lieutenant de l'acte 1, la deuxième de l'acte 2, etc.
 *
 * L'ordre a un sens fonctionnel — les offensives de fin d'acte (J10/J20/J30)
 * remettent la doctrine du lieutenant de l'acte en position dominante.
 */
export function tirerDoctrinesLune(graine_lune: bigint, config: Balance): readonly NomDoctrine[] {
  const n = config.horde.doctrines_par_lune;
  if (n > NOMS_DOCTRINES.length) {
    throw new Error(
      `tirerDoctrinesLune : doctrines_par_lune (${n}) > doctrines disponibles (${NOMS_DOCTRINES.length})`,
    );
  }
  const rng = creerRng(graine_lune).deriver("doctrines-lune");
  const pool: NomDoctrine[] = [...NOMS_DOCTRINES];
  const actives: NomDoctrine[] = [];
  for (let i = 0; i < n; i++) {
    const j = rng.entier(0, pool.length - 1);
    actives.push(pool[j]!);
    pool.splice(j, 1);
  }
  return actives;
}
