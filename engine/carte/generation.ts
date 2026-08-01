// Génération déterministe d'une carte tactique.
// Implémente strictement RULES §3 (algorithme + vérification + relâchement).
// Fonction pure : ne lit rien, n'écrit rien, ne dépend que de ses paramètres.

import type {
  Abord,
  AbordId,
  Lieu,
  LieuId,
  Lien,
  NatureLieu,
  Province,
  ProvinceId,
  SecteurId,
  TerrainId,
} from "../types/carte.js";
import type { Balance } from "../../config/schema.js";
import { creerRng, type RNG } from "../rng/index.js";
import { detecterGoulots } from "./goulots.js";

export interface EntreeGeneration {
  readonly graine: bigint;
  readonly effectif_actif: number;
  readonly province_id: ProvinceId;
  readonly province_perdue_id: ProvinceId | null;
  readonly config: Balance;
}

export interface SortieGeneration {
  readonly province: Province;
  /** Nombre total d'essais consommés, tous niveaux de relâchement confondus. */
  readonly essais_utilises: number;
  /** 0 = aucun relâchement, 1..3 = niveaux successifs appliqués. Voir RULES §3. */
  readonly niveau_relaxation: 0 | 1 | 2 | 3;
  /** Lieux identifiés comme goulots dans la province retenue. */
  readonly goulots: readonly LieuId[];
}

const TERRAINS: readonly TerrainId[] = ["crete", "marais", "foret", "plaine", "delta"];
const NIVEAUX_RELAXATION: readonly (0 | 1 | 2 | 3)[] = [0, 1, 2, 3];

// --- IDs déterministes -----------------------------------------------------

function idLieuRoyaume(n: number): LieuId {
  return `L${String(n).padStart(3, "0")}` as LieuId;
}
function idFosse(n: number): LieuId {
  return `F${String(n).padStart(3, "0")}` as LieuId;
}
function idAbord(n: number): AbordId {
  return `A${String(n).padStart(4, "0")}` as AbordId;
}
function idSecteur(n: number): SecteurId {
  return `S${String(n).padStart(2, "0")}` as SecteurId;
}

function paireCle(a: LieuId, b: LieuId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function clampInt(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

// --- Fonction principale ---------------------------------------------------

export function genererCarte(entree: EntreeGeneration): SortieGeneration {
  const rngProvince = creerRng(entree.graine).deriver(`carte-${entree.province_id}`);
  const N = clampInt(
    Math.round(entree.effectif_actif * entree.config.carte.lieux_par_joueur_actif),
    entree.config.carte.lieux_min,
    entree.config.carte.lieux_max,
  );
  const essaisMax = entree.config.generation.essais_max;

  let totalEssais = 0;
  for (const niveau of NIVEAUX_RELAXATION) {
    for (let k = 0; k < essaisMax; k++) {
      totalEssais++;
      const rng = rngProvince.deriver(`niv-${niveau}-essai-${k}`);
      const res = tenter(rng, N, entree, niveau);
      if (res !== null) {
        return {
          province: res.province,
          essais_utilises: totalEssais,
          niveau_relaxation: niveau,
          goulots: res.goulots,
        };
      }
    }
  }
  throw new Error(
    `carte/generation : échec après ${totalEssais} essais et 4 niveaux de relâchement ` +
      `(graine=${entree.graine}, N=${N}, effectif=${entree.effectif_actif})`,
  );
}

// --- Détail d'un essai -----------------------------------------------------

interface Tentative {
  readonly province: Province;
  readonly goulots: readonly LieuId[];
}

function tenter(
  rng: RNG,
  N: number,
  entree: EntreeGeneration,
  niveau: 0 | 1 | 2 | 3,
): Tentative | null {
  const { config } = entree;

  // Application des relâchements.
  const cyclesMin = niveau >= 2 ? 1 : config.generation.cycles_min;
  const cyclesMax = niveau >= 2 ? 1 : config.generation.cycles_max;
  const profondeurMax = niveau >= 3 ? 3 : config.carte.profondeur_entree_place_forte_max;
  const goulotsMin = niveau >= 1 ? 1 : config.carte.goulots_min;
  const goulotsMax = niveau >= 1 ? config.carte.goulots_max + 1 : config.carte.goulots_max;

  // Étape 2 : D sous contrainte N - entrees_min >= D
  const dMin = config.carte.profondeur_entree_place_forte_min;
  const dMax = Math.min(profondeurMax, N - config.carte.entrees_min);
  if (dMax < dMin) return null;
  const D = rng.entier(dMin, dMax);

  // Étape 3 : E sous contrainte E <= N - D
  const eMin = config.carte.entrees_min;
  const eMax = Math.min(config.carte.entrees_max, N - D);
  if (eMax < eMin) return null;
  const E = rng.entier(eMin, eMax);

  // Étape 4 : répartition en couches
  const tailles = repartir(N, D, E);
  if (tailles === null) return null;

  const lieuParCouche: LieuId[][] = [];
  const tousRoyaume: LieuId[] = [];
  let compteurL = 1;
  for (let k = 0; k <= D; k++) {
    const couche: LieuId[] = [];
    for (let i = 0; i < tailles[k]!; i++) {
      const idL = idLieuRoyaume(compteurL++);
      couche.push(idL);
      tousRoyaume.push(idL);
    }
    lieuParCouche.push(couche);
  }

  // Étape 5 : arbre — chaque lieu de couche k reçoit un parent en couche k-1 (ROUTE)
  const liens: Lien[] = [];
  for (let k = 1; k <= D; k++) {
    const parents = lieuParCouche[k - 1]!;
    for (const enfant of lieuParCouche[k]!) {
      const parent = parents[rng.entier(0, parents.length - 1)]!;
      liens.push({ a: parent, b: enfant, nature: "route" });
    }
  }

  // Étape 6 : cycles — SENTIERS entre couches identiques ou adjacentes
  const nbCycles = rng.entier(cyclesMin, cyclesMax);
  const existantes = new Set<string>(liens.map((l) => paireCle(l.a, l.b)));
  const candidates: [LieuId, LieuId][] = [];
  for (let k = 0; k <= D; k++) {
    const cette = lieuParCouche[k]!;
    for (let i = 0; i < cette.length; i++) {
      for (let j = i + 1; j < cette.length; j++) {
        const u = cette[i]!;
        const v = cette[j]!;
        if (!existantes.has(paireCle(u, v))) candidates.push([u, v]);
      }
    }
    if (k + 1 <= D) {
      const suivante = lieuParCouche[k + 1]!;
      for (const u of cette) {
        for (const v of suivante) {
          if (!existantes.has(paireCle(u, v))) candidates.push([u, v]);
        }
      }
    }
  }
  for (let i = 0; i < nbCycles && candidates.length > 0; i++) {
    const idx = rng.entier(0, candidates.length - 1);
    const [u, v] = candidates.splice(idx, 1)[0]!;
    existantes.add(paireCle(u, v));
    liens.push({ a: u, b: v, nature: "sentier" });
  }

  // Étape 7 : natures des lieux royaume
  const natures = new Map<LieuId, NatureLieu>();
  for (let k = 0; k <= D; k++) {
    for (const idL of lieuParCouche[k]!) {
      let nature: NatureLieu;
      if (k === 0) nature = "place_forte";
      else if (k === D || k === D - 1) nature = "poste_avance";
      else nature = "feu_de_guet";
      natures.set(idL, nature);
    }
  }

  // Étape 8 : abords
  const abordsParLieu = new Map<LieuId, Abord[]>();
  let compteurA = 1;
  for (const idL of tousRoyaume) {
    const nature = natures.get(idL)!;
    let nb: number;
    switch (nature) {
      case "place_forte":
        nb = rng.entier(config.combat.abords_place_forte_min, config.combat.abords_place_forte_max);
        break;
      case "feu_de_guet":
        nb = config.carte.abords.feu_de_guet;
        break;
      case "poste_avance":
        nb = config.carte.abords.poste_avance;
        break;
      case "fosse":
        // impossible ici (couvert plus bas pour les Fosses), mais couvre le typage
        nb = config.carte.abords.fosse;
        break;
    }
    const abords: Abord[] = [];
    for (let i = 0; i < nb; i++) {
      abords.push({ id: idAbord(compteurA++), index_anneau: i, fortification: 0 });
    }
    abordsParLieu.set(idL, abords);
  }

  // Étape 9 : terrain
  const dominant = TERRAINS[rng.entier(0, TERRAINS.length - 1)]!;
  const terrainParLieu = new Map<LieuId, TerrainId>();
  for (const idL of tousRoyaume) {
    if (rng.flottant() < config.generation.part_terrain_dominant) {
      terrainParLieu.set(idL, dominant);
    } else {
      terrainParLieu.set(idL, TERRAINS[rng.entier(0, TERRAINS.length - 1)]!);
    }
  }

  // Étape 10 : Fosses (nature "fosse", tenues par la horde)
  const nbFosses = rng.entier(config.generation.fosses_min, config.generation.fosses_max);
  const fosses: LieuId[] = [];
  const entrees = lieuParCouche[D]!;
  let compteurF = 1;
  for (let f = 0; f < nbFosses; f++) {
    const idF = idFosse(compteurF++);
    fosses.push(idF);
    natures.set(idF, "fosse");
    terrainParLieu.set(idF, TERRAINS[rng.entier(0, TERRAINS.length - 1)]!);
    const abords: Abord[] = [];
    for (let i = 0; i < config.carte.abords.fosse; i++) {
      abords.push({ id: idAbord(compteurA++), index_anneau: i, fortification: 0 });
    }
    abordsParLieu.set(idF, abords);
    const entree = entrees[rng.entier(0, entrees.length - 1)]!;
    liens.push({ a: entree, b: idF, nature: "sentier" });
  }

  // Étape 11 : entrée principale (dérivée de province_perdue_id, stable entre lunes)
  const ctxPrincipale = `entree-principale-${entree.province_perdue_id ?? "aucune"}`;
  const rngPrincipale = rng.deriver(ctxPrincipale);
  const entree_principale = entrees[rngPrincipale.entier(0, entrees.length - 1)]!;

  // Étape 12 : secteurs
  const secteurParLieu = new Map<LieuId, SecteurId | null>();
  const pfId = lieuParCouche[0]![0]!;
  if (entree.effectif_actif >= config.grades.seuils_effectif.capitaine) {
    const parentDe = new Map<LieuId, LieuId>();
    for (const lien of liens) {
      if (lien.nature !== "route") continue;
      // Dans notre construction, a est parent (couche k-1), b est enfant (couche k).
      parentDe.set(lien.b, lien.a);
    }
    // Un secteur par enfant direct de la PF.
    const enfantsPF: LieuId[] = [];
    for (const [enfant, parent] of parentDe) {
      if (parent === pfId) enfantsPF.push(enfant);
    }
    let compteurS = 1;
    for (const racine of enfantsPF) {
      const sid = idSecteur(compteurS++);
      const pile: LieuId[] = [racine];
      while (pile.length > 0) {
        const cur = pile.pop()!;
        secteurParLieu.set(cur, sid);
        for (const [enfant, parent] of parentDe) {
          if (parent === cur) pile.push(enfant);
        }
      }
    }
    secteurParLieu.set(pfId, null);
  } else {
    const sid = idSecteur(1);
    for (const idL of tousRoyaume) {
      if (idL === pfId) secteurParLieu.set(idL, null);
      else secteurParLieu.set(idL, sid);
    }
  }
  for (const f of fosses) secteurParLieu.set(f, null);

  // Assemblage
  const lieux: Lieu[] = [];
  for (const idL of tousRoyaume) {
    lieux.push({
      id: idL,
      nature: natures.get(idL)!,
      terrain: terrainParLieu.get(idL)!,
      secteur_id: secteurParLieu.get(idL) ?? null,
      abords: abordsParLieu.get(idL)!,
      tenu_par: "royaume",
    });
  }
  for (const idF of fosses) {
    lieux.push({
      id: idF,
      nature: "fosse",
      terrain: terrainParLieu.get(idF)!,
      secteur_id: null,
      abords: abordsParLieu.get(idF)!,
      tenu_par: "horde",
    });
  }

  const province: Province = {
    id: entree.province_id,
    lieux,
    liens,
    entrees,
    entree_principale,
    place_forte_id: pfId,
    fosses,
  };

  // Vérification
  const goulots = detecterGoulots(province);
  if (goulots.length < goulotsMin || goulots.length > goulotsMax) return null;
  const distances = bfsRoutes(pfId, province);
  for (const l of lieux) {
    if (l.tenu_par !== "royaume") continue;
    const d = distances.get(l.id);
    if (d === undefined || d > D) return null;
  }

  return { province, goulots };
}

// --- Helpers internes ------------------------------------------------------

function repartir(N: number, D: number, E: number): number[] | null {
  const reste = N - 1 - E;
  if (reste < D - 1) return null;
  const couches = new Array<number>(D + 1);
  couches[0] = 1;
  couches[D] = E;
  if (D === 1) return couches;
  const poidsSomme = ((D - 1) * D) / 2; // 1 + 2 + ... + (D-1)
  let affecte = 0;
  for (let k = 1; k <= D - 1; k++) {
    const brut = (k * reste) / poidsSomme;
    couches[k] = Math.max(1, Math.round(brut));
    affecte += couches[k]!;
  }
  const correction = reste - affecte;
  couches[D - 1]! += correction;
  if (couches[D - 1]! < 1) return null;
  return couches;
}

function bfsRoutes(source: LieuId, province: Province): Map<LieuId, number> {
  const voisins = new Map<LieuId, LieuId[]>();
  for (const l of province.lieux) voisins.set(l.id, []);
  for (const lien of province.liens) {
    if (lien.nature !== "route") continue;
    voisins.get(lien.a)!.push(lien.b);
    voisins.get(lien.b)!.push(lien.a);
  }
  const dist = new Map<LieuId, number>([[source, 0]]);
  const file: LieuId[] = [source];
  let head = 0;
  while (head < file.length) {
    const cur = file[head++]!;
    const d = dist.get(cur)!;
    for (const v of voisins.get(cur) ?? []) {
      if (!dist.has(v)) {
        dist.set(v, d + 1);
        file.push(v);
      }
    }
  }
  return dist;
}
