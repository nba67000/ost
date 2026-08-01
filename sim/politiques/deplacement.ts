// Helpers partagés par les politiques réactif et prévoyant.
// Toutes les deux utilisent le déplacement de garnison (RULES §4) pour
// concentrer sur des lieux CIBLES — la seule différence est le choix des
// cibles (exposés actuels vs. exposés anticipés).

import type { AbordId, LieuId, Province } from "../../engine/types/carte.js";
import type { Garnison } from "../../engine/types/garnison.js";

/**
 * BFS sur le graphe des lieux ROYAUME (routes + sentiers).
 * Retourne le prochain saut à effectuer depuis `from` pour rejoindre `to`
 * par un plus court chemin. Null si `from === to` ou pas de chemin.
 * Départage lexicographique sur les voisins pour reproductibilité.
 */
export function prochainSaut(from: LieuId, to: LieuId, province: Province): LieuId | null {
  if (from === to) return null;
  const parId = new Map(province.lieux.map((l) => [l.id, l]));
  const voisinsRy = new Map<LieuId, LieuId[]>();
  for (const l of province.lieux) {
    if (l.tenu_par === "royaume") voisinsRy.set(l.id, []);
  }
  for (const lien of province.liens) {
    const a = parId.get(lien.a);
    const b = parId.get(lien.b);
    if (a === undefined || b === undefined) continue;
    if (a.tenu_par !== "royaume" || b.tenu_par !== "royaume") continue;
    voisinsRy.get(a.id)!.push(b.id);
    voisinsRy.get(b.id)!.push(a.id);
  }
  if (!voisinsRy.has(from) || !voisinsRy.has(to)) return null;

  // BFS depuis `to` pour connaître la distance à toute source.
  const dist = new Map<LieuId, number>();
  dist.set(to, 0);
  const queue: LieuId[] = [to];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    const d = dist.get(cur)!;
    for (const v of voisinsRy.get(cur) ?? []) {
      if (!dist.has(v)) {
        dist.set(v, d + 1);
        queue.push(v);
      }
    }
  }
  const dFrom = dist.get(from);
  if (dFrom === undefined) return null;

  // Parmi les voisins de `from`, prendre celui à distance dFrom − 1.
  let meilleur: LieuId | null = null;
  for (const v of voisinsRy.get(from) ?? []) {
    if (dist.get(v) === dFrom - 1) {
      if (meilleur === null || (v as string) < (meilleur as string)) meilleur = v;
    }
  }
  return meilleur;
}

/**
 * Trouve le lieu (avec paquet ou réserve) où réside actuellement un joueur.
 * Null si le joueur n'est nulle part (nouveau, en transit, ou hors carte).
 */
export function lieuActuel(
  joueur_id: import("../../engine/types/garnison.js").JoueurId,
  garnisons: ReadonlyMap<LieuId, Garnison>,
): LieuId | null {
  for (const [lid, g] of garnisons) {
    for (const p of g.paquets) if (p.joueurs.includes(joueur_id)) return lid;
    if (g.reserve.includes(joueur_id)) return lid;
  }
  return null;
}

/**
 * Abord d'un lieu à privilégier pour un placement défensif : le plus
 * fortifié en premier (mieux valorisé par la coordination), départage lex.
 */
export function abordPrioritaire(lieu_id: LieuId, province: Province): AbordId | null {
  const lieu = province.lieux.find((l) => l.id === lieu_id);
  if (lieu === undefined || lieu.abords.length === 0) return null;
  let meilleur = lieu.abords[0]!;
  for (const a of lieu.abords) {
    if (
      a.fortification > meilleur.fortification ||
      (a.fortification === meilleur.fortification && (a.id as string) < (meilleur.id as string))
    ) {
      meilleur = a;
    }
  }
  return meilleur.id;
}
