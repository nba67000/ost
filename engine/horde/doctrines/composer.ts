// Outils partagés par les doctrines : composition d'une vague à partir d'un
// profil et d'un volume, tri stable, mesures géographiques et défensives.

import type { AbordId, Lieu, LieuId, Province } from "../../types/carte.js";
import type { Garnison } from "../../types/garnison.js";
import type { TypeForge, Vague } from "../../types/forge.js";
import type { Composition, CtxCiblage } from "./types.js";

const TYPES_FORGE: readonly TypeForge[] = [
  "souche",
  "ecorcheur",
  "belier",
  "chien_de_fosse",
  "muet",
];

/**
 * Compose une Vague à partir du volume alloué et du profil de la doctrine.
 * Les effectifs sont arrondis à l'entier — on répercute l'arrondi sur la
 * souche pour préserver le total exact.
 */
export function composerVague(
  lieu_id: LieuId,
  abord_id: AbordId,
  volume: number,
  profil: Composition,
): Vague {
  const composition: Record<TypeForge, number> = {
    souche: 0,
    ecorcheur: 0,
    belier: 0,
    chien_de_fosse: 0,
    muet: 0,
  };
  let alloue = 0;
  for (const t of TYPES_FORGE) {
    if (t === "souche") continue;
    const n = Math.floor(volume * profil[t]);
    composition[t] = n;
    alloue += n;
  }
  // Le reste va à la souche : ni gaspillé, ni fabriqué.
  composition.souche = Math.max(0, Math.floor(volume) - alloue);
  return { lieu_id, abord_id, composition };
}

/**
 * Somme des fortifications des abords d'un lieu — proxy de « place la plus
 * dure ». Utilisé par Marteau, Serpent, Garde.
 */
export function fortificationTotale(lieu: Lieu): number {
  let s = 0;
  for (const a of lieu.abords) s += a.fortification;
  return s;
}

/**
 * Effectif garnison total d'un lieu (paquets + réserve). Réserve comptée
 * comme un effectif de 1 par joueur — la doctrine Meute cherche le lieu le
 * plus « négligé » sans distinguer paquet et réserve.
 */
export function effectifGarnison(garnison: Garnison | undefined): number {
  if (garnison === undefined) return 0;
  let s = 0;
  for (const p of garnison.paquets) s += p.effectif;
  s += garnison.reserve.length;
  return s;
}

/**
 * Effectif d'un abord précis (paquet affecté, réserve exclue). Utilisé par
 * Meute pour l'abord le moins garni.
 */
export function effectifAbord(garnison: Garnison | undefined, abord_id: AbordId): number {
  if (garnison === undefined) return 0;
  for (const p of garnison.paquets) if (p.abord_id === abord_id) return p.effectif;
  return 0;
}

/**
 * Tri stable par LieuId — sert de départage déterministe partout où une
 * doctrine hésite entre deux candidats équivalents sur son critère principal.
 */
export function triLexicographique(ids: readonly LieuId[]): readonly LieuId[] {
  return [...ids].sort((a, b) => (a as string).localeCompare(b as string, "en"));
}

/**
 * Trie une liste de lieux par une clef numérique DÉCROISSANTE (le plus grand
 * en tête), avec départage lexicographique par LieuId pour rester
 * déterministe indépendamment de l'ordre d'entrée.
 */
export function trierDecroissant(
  ids: readonly LieuId[],
  clef: (id: LieuId) => number,
): readonly LieuId[] {
  return [...ids].sort((a, b) => {
    const dv = clef(b) - clef(a);
    if (dv !== 0) return dv;
    return (a as string).localeCompare(b as string, "en");
  });
}

/** Tri croissant, mêmes garanties. */
export function trierCroissant(
  ids: readonly LieuId[],
  clef: (id: LieuId) => number,
): readonly LieuId[] {
  return [...ids].sort((a, b) => {
    const dv = clef(a) - clef(b);
    if (dv !== 0) return dv;
    return (a as string).localeCompare(b as string, "en");
  });
}

/**
 * Résolveur d'index de lieu. Les doctrines n'ont pas la carte en Map — on la
 * construit une fois via ce helper.
 */
export function indexerLieux(province: Province): ReadonlyMap<LieuId, Lieu> {
  const m = new Map<LieuId, Lieu>();
  for (const l of province.lieux) m.set(l.id, l);
  return m;
}

/**
 * BFS des distances (en nombre de liens, routes + sentiers) depuis un lieu
 * source. Utilisé par Garde pour retrouver le lieu exposé le plus proche de
 * l'entrée principale quand celle-ci n'est plus royaume.
 */
export function distancesDepuis(source: LieuId, ctx: CtxCiblage): ReadonlyMap<LieuId, number> {
  const voisins = new Map<LieuId, LieuId[]>();
  for (const l of ctx.province.lieux) voisins.set(l.id, []);
  for (const lien of ctx.province.liens) {
    voisins.get(lien.a)?.push(lien.b);
    voisins.get(lien.b)?.push(lien.a);
  }
  const d = new Map<LieuId, number>([[source, 0]]);
  const file: LieuId[] = [source];
  let head = 0;
  while (head < file.length) {
    const cur = file[head++]!;
    const distCur = d.get(cur)!;
    for (const v of voisins.get(cur) ?? []) {
      if (!d.has(v)) {
        d.set(v, distCur + 1);
        file.push(v);
      }
    }
  }
  return d;
}
