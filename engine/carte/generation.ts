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

/** Motif de rejet d'un essai de génération. */
export type MotifRejet =
  "arithmetique_impossible" | "goulots_trop_peu" | "goulots_trop_nombreux" | "profondeur_depassee";

/** Trace d'un essai : ce qui a été tiré, et pourquoi il a été retenu ou rejeté. */
export interface DiagnosticEssai {
  readonly niveau: 0 | 1 | 2 | 3;
  /** Index de l'essai dans son niveau, 0-based. */
  readonly essai: number;
  readonly D_tire: number | null;
  readonly E_tire: number | null;
  readonly nb_cycles: number | null;
  readonly nb_goulots: number | null;
  /** null = essai retenu. */
  readonly motif_rejet: MotifRejet | null;
}

export interface SortieGeneration {
  readonly province: Province;
  /** Nombre total d'essais consommés, tous niveaux de relâchement confondus. */
  readonly essais_utilises: number;
  /** 0 = aucun relâchement, 1..3 = niveaux successifs appliqués. Voir RULES §3. */
  readonly niveau_relaxation: 0 | 1 | 2 | 3;
  /** Lieux identifiés comme goulots dans la province retenue. */
  readonly goulots: readonly LieuId[];
  /**
   * Trace de tous les essais consommés (rejets + essai retenu en dernière position).
   * Instrumentation destinée à `carte:stats` pour comprendre la sélection.
   */
  readonly diagnostic: readonly DiagnosticEssai[];
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

  const diagnostic: DiagnosticEssai[] = [];
  let totalEssais = 0;
  for (const niveau of NIVEAUX_RELAXATION) {
    for (let k = 0; k < essaisMax; k++) {
      totalEssais++;
      const rng = rngProvince.deriver(`niv-${niveau}-essai-${k}`);
      const res = tenter(rng, N, entree, niveau, k);
      diagnostic.push(res.diagnostic);
      if (res.retenu) {
        return {
          province: res.province,
          essais_utilises: totalEssais,
          niveau_relaxation: niveau,
          goulots: res.goulots,
          diagnostic,
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

type ResultatEssai =
  | {
      readonly retenu: true;
      readonly province: Province;
      readonly goulots: readonly LieuId[];
      readonly diagnostic: DiagnosticEssai;
    }
  | {
      readonly retenu: false;
      readonly diagnostic: DiagnosticEssai;
    };

function tenter(
  rng: RNG,
  N: number,
  entree: EntreeGeneration,
  niveau: 0 | 1 | 2 | 3,
  indexEssai: number,
): ResultatEssai {
  const { config } = entree;

  // Application des relâchements.
  const cyclesMinCfg = niveau >= 2 ? 1 : config.generation.cycles_min;
  const cyclesMaxCfg = niveau >= 2 ? 1 : config.generation.cycles_max;
  const profondeurMax = niveau >= 3 ? 3 : config.carte.profondeur_entree_place_forte_max;
  const goulotsMinBase = niveau >= 1 ? 1 : config.carte.goulots_min;
  // Cap structurel : dans une chaîne de N lieux, il y a au plus N-3 goulots
  // (chaque intérieur qui déconnecte >= 2 lieux royaume). Pour N ≤ 4, on ne
  // peut pas exiger 2 goulots ; on accepte donc silencieusement moins, sans
  // compter cela comme un relâchement.
  const goulotsMin = Math.min(goulotsMinBase, Math.max(0, N - 3));
  const goulotsMax = niveau >= 1 ? config.carte.goulots_max + 1 : config.carte.goulots_max;

  const rejete = (partiel: {
    D_tire: number | null;
    E_tire: number | null;
    nb_cycles: number | null;
    nb_goulots: number | null;
    motif_rejet: MotifRejet;
  }): ResultatEssai => ({
    retenu: false,
    diagnostic: { niveau, essai: indexEssai, ...partiel },
  });

  // Étape 2 : D sous contrainte E >= entrees_min ⇒ D ≤ N - entrees_min
  const dMin = config.carte.profondeur_entree_place_forte_min;
  const dMax = Math.min(profondeurMax, N - config.carte.entrees_min);
  if (dMax < 1) {
    return rejete({
      D_tire: null,
      E_tire: null,
      nb_cycles: null,
      nb_goulots: null,
      motif_rejet: "arithmetique_impossible",
    });
  }
  // Cap dMin à dMax : pour les petites cartes (N=3), la profondeur cible n'est
  // structurellement pas atteignable. On accepte D < dMin sans le compter comme
  // un rejet — c'est une conséquence de la taille, pas un échec du tirage.
  const dMinEffectif = Math.min(dMin, dMax);
  const D = rng.entier(dMinEffectif, dMax);

  // Étape 3 : E sous contrainte E ≤ N - D
  const eMin = config.carte.entrees_min;
  const eMax = Math.min(config.carte.entrees_max, N - D);
  if (eMax < eMin) {
    return rejete({
      D_tire: D,
      E_tire: null,
      nb_cycles: null,
      nb_goulots: null,
      motif_rejet: "arithmetique_impossible",
    });
  }
  const E = rng.entier(eMin, eMax);

  // Étape 4 : répartition en couches
  const tailles = repartir(N, D, E);
  if (tailles === null) {
    return rejete({
      D_tire: D,
      E_tire: E,
      nb_cycles: null,
      nb_goulots: null,
      motif_rejet: "arithmetique_impossible",
    });
  }

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

  // Étape 6 : cycles — SENTIERS entre couches identiques ou adjacentes.
  // Nombre déterministe fonction de N (voir RULES §3), pour que les cycles
  // croissent avec la carte au lieu de rester fixes.
  const nbCyclesCible = clampInt(
    Math.round(N / config.generation.cycles_par_lieux),
    cyclesMinCfg,
    cyclesMaxCfg,
  );
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
  let nbCyclesReels = 0;
  for (let i = 0; i < nbCyclesCible && candidates.length > 0; i++) {
    const idx = rng.entier(0, candidates.length - 1);
    const [u, v] = candidates.splice(idx, 1)[0]!;
    existantes.add(paireCle(u, v));
    liens.push({ a: u, b: v, nature: "sentier" });
    nbCyclesReels++;
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
      parentDe.set(lien.b, lien.a);
    }
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

  // Vérification.
  const goulots = detecterGoulots(province);
  if (goulots.length < goulotsMin) {
    return rejete({
      D_tire: D,
      E_tire: E,
      nb_cycles: nbCyclesReels,
      nb_goulots: goulots.length,
      motif_rejet: "goulots_trop_peu",
    });
  }
  if (goulots.length > goulotsMax) {
    return rejete({
      D_tire: D,
      E_tire: E,
      nb_cycles: nbCyclesReels,
      nb_goulots: goulots.length,
      motif_rejet: "goulots_trop_nombreux",
    });
  }
  const distances = bfsRoutes(pfId, province);
  for (const l of lieux) {
    if (l.tenu_par !== "royaume") continue;
    const d = distances.get(l.id);
    if (d === undefined || d > D) {
      return rejete({
        D_tire: D,
        E_tire: E,
        nb_cycles: nbCyclesReels,
        nb_goulots: goulots.length,
        motif_rejet: "profondeur_depassee",
      });
    }
  }

  return {
    retenu: true,
    province,
    goulots,
    diagnostic: {
      niveau,
      essai: indexEssai,
      D_tire: D,
      E_tire: E,
      nb_cycles: nbCyclesReels,
      nb_goulots: goulots.length,
      motif_rejet: null,
    },
  };
}

// --- Helpers internes ------------------------------------------------------

function repartir(N: number, D: number, E: number): number[] | null {
  const reste = N - 1 - E;
  if (reste < D - 1) return null;
  const couches = new Array<number>(D + 1);
  couches[0] = 1;
  couches[D] = E;
  if (D === 1) return couches;
  const poidsSomme = ((D - 1) * D) / 2;
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
