// Fragilité par lieu : combien de lieux royaume perdent leur approvisionnement
// (BFS routes-only depuis la place forte) si un lieu donné tombe.
//
// Utilisé par la génération (étape 6a, phase A du greedy), par la vérification
// (motif fragilite_excessive), par carte:fragilite (rendu) et carte:stats
// (agrégation).

import type { Lien, LieuId } from "../types/carte.js";

export interface ImpactLieu {
  readonly lieu_id: LieuId;
  /** Nombre d'autres lieux royaume qui perdent leur approvisionnement si ce lieu tombe. */
  readonly coupes: number;
}

export function calculerFragilite(
  royaumeIds: ReadonlySet<LieuId>,
  liens: readonly Lien[],
  place_forte: LieuId,
): readonly ImpactLieu[] {
  const initial = connectesParRoutes(place_forte, royaumeIds, liens, null);
  const result: ImpactLieu[] = [];
  for (const id of royaumeIds) {
    if (id === place_forte) continue;
    const apres = connectesParRoutes(place_forte, royaumeIds, liens, id);
    let coupes = 0;
    for (const other of royaumeIds) {
      if (other === id) continue;
      if (initial.has(other) && !apres.has(other)) coupes++;
    }
    result.push({ lieu_id: id, coupes });
  }
  return result;
}

export function fragiliteMaximale(impacts: readonly ImpactLieu[]): number {
  let max = 0;
  for (const i of impacts) if (i.coupes > max) max = i.coupes;
  return max;
}

/**
 * Retourne les impacts triés par gravité décroissante.
 * Utilitaire pour la lecture (CLI, stats).
 */
export function fragiliteParRang(impacts: readonly ImpactLieu[]): readonly ImpactLieu[] {
  return [...impacts].sort((a, b) => b.coupes - a.coupes || a.lieu_id.localeCompare(b.lieu_id));
}

function connectesParRoutes(
  source: LieuId,
  royaumeIds: ReadonlySet<LieuId>,
  liens: readonly Lien[],
  exclu: LieuId | null,
): Set<LieuId> {
  if (source === exclu || !royaumeIds.has(source)) return new Set();
  const voisins = new Map<LieuId, LieuId[]>();
  for (const id of royaumeIds) {
    if (id !== exclu) voisins.set(id, []);
  }
  for (const lien of liens) {
    if (lien.nature !== "route") continue;
    if (lien.a === exclu || lien.b === exclu) continue;
    if (!royaumeIds.has(lien.a) || !royaumeIds.has(lien.b)) continue;
    voisins.get(lien.a)!.push(lien.b);
    voisins.get(lien.b)!.push(lien.a);
  }
  const vus = new Set<LieuId>([source]);
  const file: LieuId[] = [source];
  let head = 0;
  while (head < file.length) {
    const cur = file[head++]!;
    for (const v of voisins.get(cur) ?? []) {
      if (!vus.has(v)) {
        vus.add(v);
        file.push(v);
      }
    }
  }
  return vus;
}
