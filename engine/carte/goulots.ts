// Détection des goulots par simulation de suppression.
// Un lieu est un goulot si sa perte déconnecte au moins deux autres lieux royaume
// de la place forte, sur le graphe des routes seules. RULES §3 (vérification).

import type { LieuId, Lien, Province } from "../types/carte.js";

export function detecterGoulots(province: Province): readonly LieuId[] {
  const royaume = new Set<LieuId>(
    province.lieux.filter((l) => l.tenu_par === "royaume").map((l) => l.id),
  );
  const routes = province.liens.filter((l) => l.nature === "route");
  const pf = province.place_forte_id;

  const goulots: LieuId[] = [];
  for (const id of royaume) {
    if (id === pf) continue;
    const atteignables = compterAtteignables(pf, id, royaume, routes);
    const inaccessibles = royaume.size - 1 - atteignables;
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
