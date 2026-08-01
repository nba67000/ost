// Détection des goulots par simulation de suppression.
// Un lieu est un goulot si sa perte déconnecte au moins deux autres lieux royaume
// de la place forte, sur le graphe des routes seules. RULES §3.

import type { LieuId, Lien } from "../types/carte.js";

/**
 * Signature primitive — pratique pendant la génération, avant que la Province
 * complète existe. Le caller fournit l'ensemble des IDs royaume, tous les liens
 * (les sentiers seront filtrés), et l'id de la place forte.
 */
export function detecterGoulots(
  royaumeIds: ReadonlySet<LieuId>,
  liens: readonly Lien[],
  place_forte_id: LieuId,
): readonly LieuId[] {
  const routes = liens.filter((l) => l.nature === "route");
  const goulots: LieuId[] = [];
  for (const id of royaumeIds) {
    if (id === place_forte_id) continue;
    const atteignables = compterAtteignables(place_forte_id, id, royaumeIds, routes);
    const inaccessibles = royaumeIds.size - 1 - atteignables;
    if (inaccessibles >= 2) goulots.push(id);
  }
  return goulots;
}

function compterAtteignables(
  source: LieuId,
  exclu: LieuId,
  royaume: ReadonlySet<LieuId>,
  routes: readonly Lien[],
): number {
  if (source === exclu) return 0;
  const voisins = new Map<LieuId, LieuId[]>();
  for (const id of royaume) voisins.set(id, []);
  for (const r of routes) {
    if (r.a === exclu || r.b === exclu) continue;
    if (voisins.has(r.a) && voisins.has(r.b)) {
      voisins.get(r.a)!.push(r.b);
      voisins.get(r.b)!.push(r.a);
    }
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
  return vus.size;
}
