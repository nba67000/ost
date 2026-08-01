// Détection des lieux exposés à la horde.
// Voir RULES §7 : « Un lieu est exposé s'il est adjacent à un lieu tenu par
// la horde ou à une entrée. »
//
// Fonction pure sur la province — aucune I/O.

import type { LieuId, Lien, Lieu } from "../types/carte.js";

/**
 * Ensemble des lieux royaume adjacents à un lieu horde ou à une entrée du
 * royaume. Utilise routes ET sentiers : un raid peut passer par un sentier.
 *
 * Un lieu est exposé si l'une des conditions suivantes est vraie :
 * - il est une entrée du royaume ;
 * - il a un voisin dont `tenu_par = "horde"`.
 *
 * Les lieux détruits (fosses percées) ne sont pas exposés — ils ne peuvent
 * plus être attaqués. Les lieux horde ne sont pas non plus dans le résultat :
 * seuls les lieux tenus par le royaume sont candidats.
 */
export function lieuxExposes(
  lieux: readonly Lieu[],
  liens: readonly Lien[],
  entrees: readonly LieuId[],
): readonly LieuId[] {
  const parId = new Map<LieuId, Lieu>();
  for (const l of lieux) parId.set(l.id, l);

  const entreesSet = new Set(entrees);
  const exposes = new Set<LieuId>();

  // Entrées royaume : exposées d'office.
  for (const id of entreesSet) {
    const l = parId.get(id);
    if (l !== undefined && l.tenu_par === "royaume") exposes.add(id);
  }

  // Adjacents à un lieu horde.
  for (const lien of liens) {
    const a = parId.get(lien.a);
    const b = parId.get(lien.b);
    if (a === undefined || b === undefined) continue;
    if (a.tenu_par === "royaume" && b.tenu_par === "horde") exposes.add(a.id);
    if (b.tenu_par === "royaume" && a.tenu_par === "horde") exposes.add(b.id);
  }

  return [...exposes];
}
