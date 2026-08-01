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
export type MotifRejet = "arithmetique_impossible" | "profondeur_depassee";

/** Trace d'un essai : ce qui a été tiré et construit, et le motif de rejet éventuel. */
export interface DiagnosticEssai {
  readonly niveau: 0 | 1 | 2 | 3;
  readonly essai: number;
  readonly D_tire: number | null;
  readonly E_tire: number | null;
  readonly nb_routes_redondantes: number | null;
  readonly nb_sentiers: number | null;
  readonly nb_goulots: number | null;
  /** null = essai retenu. */
  readonly motif_rejet: MotifRejet | null;
}

export interface SortieGeneration {
  readonly province: Province;
  readonly essais_utilises: number;
  readonly niveau_relaxation: 0 | 1 | 2 | 3;
  readonly goulots: readonly LieuId[];
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

/** Bornes de goulots dérivées de N, avec plancher et fenêtre minimale. */
function bornesGoulots(N: number, config: Balance): { min: number; max: number } {
  const min = Math.max(0, Math.round(N * config.carte.goulots_coef_min));
  let max = Math.round(N * config.carte.goulots_coef_max);
  const fenetre = config.carte.goulots_fenetre_min;
  if (max - min < fenetre) max = min + fenetre;
  return { min, max };
}

function tenter(
  rng: RNG,
  N: number,
  entree: EntreeGeneration,
  niveau: 0 | 1 | 2 | 3,
  indexEssai: number,
): ResultatEssai {
  const { config } = entree;

  // Application des relâchements — seuls la profondeur et le nombre de sentiers
  // sont relâchables. Les bornes de goulots ne sont plus un critère de rejet.
  const sentiersMinCfg = niveau >= 1 ? 1 : config.generation.sentiers_min;
  const sentiersMaxCfg = niveau >= 1 ? 1 : config.generation.sentiers_max;
  const profondeurMax = niveau >= 2 ? 3 : config.carte.profondeur_entree_place_forte_max;

  const { max: goulotsCible } = bornesGoulots(N, config);

  const rejete = (partiel: {
    D_tire: number | null;
    E_tire: number | null;
    nb_routes_redondantes: number | null;
    nb_sentiers: number | null;
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
      nb_routes_redondantes: null,
      nb_sentiers: null,
      nb_goulots: null,
      motif_rejet: "arithmetique_impossible",
    });
  }
  // Cap dMin à dMax : pour les petites cartes, la profondeur cible n'est
  // structurellement pas atteignable. On accepte D < dMin sans le compter
  // comme un rejet.
  const dMinEffectif = Math.min(dMin, dMax);
  const D = rng.entier(dMinEffectif, dMax);

  // Étape 3 : E sous contrainte E ≤ N - D
  const eMin = config.carte.entrees_min;
  const eMax = Math.min(config.carte.entrees_max, N - D);
  if (eMax < eMin) {
    return rejete({
      D_tire: D,
      E_tire: null,
      nb_routes_redondantes: null,
      nb_sentiers: null,
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
      nb_routes_redondantes: null,
      nb_sentiers: null,
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
  const royaumeSet: ReadonlySet<LieuId> = new Set(tousRoyaume);
  const pfId = lieuParCouche[0]![0]!;

  // Étape 5 : arbre — chaque lieu de couche k reçoit un parent en couche k-1 (ROUTE)
  const liens: Lien[] = [];
  for (let k = 1; k <= D; k++) {
    const parents = lieuParCouche[k - 1]!;
    for (const enfant of lieuParCouche[k]!) {
      const parent = parents[rng.entier(0, parents.length - 1)]!;
      liens.push({ a: parent, b: enfant, nature: "route" });
    }
  }

  // Candidats pour arêtes supplémentaires : paires même couche ou couches
  // adjacentes, pas déjà dans l'arbre.
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

  // Étape 6a : routes redondantes — ajoutées de façon gloutonne pour faire
  // descendre les goulots dans la fenêtre. Chaque itération choisit l'arête
  // qui supprime le plus de goulots. S'arrête dès que goulots <= cible, ou
  // qu'aucune arête candidate ne réduit plus de goulots.
  let goulotsCourants = detecterGoulots(royaumeSet, liens, pfId);
  let nbRoutesRedondantes = 0;
  while (goulotsCourants.length > goulotsCible && candidates.length > 0) {
    let meilleurIdx = -1;
    let meilleureReduction = 0;
    for (let idx = 0; idx < candidates.length; idx++) {
      const [u, v] = candidates[idx]!;
      liens.push({ a: u, b: v, nature: "route" });
      const nvxGoulots = detecterGoulots(royaumeSet, liens, pfId);
      liens.pop();
      const reduction = goulotsCourants.length - nvxGoulots.length;
      if (reduction > meilleureReduction) {
        meilleureReduction = reduction;
        meilleurIdx = idx;
      }
    }
    if (meilleurIdx === -1) break;
    const [u, v] = candidates[meilleurIdx]!;
    liens.push({ a: u, b: v, nature: "route" });
    existantes.add(paireCle(u, v));
    candidates.splice(meilleurIdx, 1);
    goulotsCourants = detecterGoulots(royaumeSet, liens, pfId);
    nbRoutesRedondantes++;
  }

  // Étape 6b : sentiers — nombre déterministe fonction de N, purement tactiques
  // (ne réduisent aucun goulot puisque le ravitaillement ne passe que par les
  // routes). Tirés parmi les candidats restants.
  const nbSentiersCible = clampInt(
    Math.round(N / config.generation.sentiers_par_lieux),
    sentiersMinCfg,
    sentiersMaxCfg,
  );
  let nbSentiersReels = 0;
  for (let i = 0; i < nbSentiersCible && candidates.length > 0; i++) {
    const idx = rng.entier(0, candidates.length - 1);
    const [u, v] = candidates.splice(idx, 1)[0]!;
    existantes.add(paireCle(u, v));
    liens.push({ a: u, b: v, nature: "sentier" });
    nbSentiersReels++;
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

  // Étape 10 : Fosses
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

  // Étape 11 : entrée principale
  const ctxPrincipale = `entree-principale-${entree.province_perdue_id ?? "aucune"}`;
  const rngPrincipale = rng.deriver(ctxPrincipale);
  const entree_principale = entrees[rngPrincipale.entier(0, entrees.length - 1)]!;

  // Étape 12 : secteurs
  const secteurParLieu = new Map<LieuId, SecteurId | null>();
  if (entree.effectif_actif >= config.grades.seuils_effectif.capitaine) {
    // Sur le graphe des routes, la place forte a plusieurs enfants directs.
    // Un secteur = un sous-arbre issu d'un de ces enfants. Comme la carte
    // contient maintenant des routes redondantes (cycles), on utilise un
    // parcours BFS routes-only depuis la PF, en attribuant chaque lieu au
    // secteur du premier enfant PF rencontré sur son chemin le plus court.
    const voisinsRoutes = new Map<LieuId, LieuId[]>();
    for (const idL of tousRoyaume) voisinsRoutes.set(idL, []);
    for (const lien of liens) {
      if (lien.nature !== "route") continue;
      voisinsRoutes.get(lien.a)!.push(lien.b);
      voisinsRoutes.get(lien.b)!.push(lien.a);
    }
    const secteurDe = new Map<LieuId, SecteurId | null>();
    secteurDe.set(pfId, null);
    const enfantsPF: LieuId[] = [...(voisinsRoutes.get(pfId) ?? [])];
    let compteurS = 1;
    for (const racine of enfantsPF) {
      if (secteurDe.has(racine)) continue;
      const sid = idSecteur(compteurS++);
      const file: LieuId[] = [racine];
      secteurDe.set(racine, sid);
      let head = 0;
      while (head < file.length) {
        const cur = file[head++]!;
        for (const v of voisinsRoutes.get(cur) ?? []) {
          if (v === pfId) continue;
          if (!secteurDe.has(v)) {
            secteurDe.set(v, sid);
            file.push(v);
          }
        }
      }
    }
    for (const [idL, sid] of secteurDe) secteurParLieu.set(idL, sid);
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

  // Vérification résiduelle : profondeur uniquement. Les goulots sont
  // désormais contraints par construction (étape 6a), pas par rejet.
  const distances = bfsRoutes(pfId, province);
  for (const l of lieux) {
    if (l.tenu_par !== "royaume") continue;
    const d = distances.get(l.id);
    if (d === undefined || d > D) {
      return rejete({
        D_tire: D,
        E_tire: E,
        nb_routes_redondantes: nbRoutesRedondantes,
        nb_sentiers: nbSentiersReels,
        nb_goulots: goulotsCourants.length,
        motif_rejet: "profondeur_depassee",
      });
    }
  }

  return {
    retenu: true,
    province,
    goulots: goulotsCourants,
    diagnostic: {
      niveau,
      essai: indexEssai,
      D_tire: D,
      E_tire: E,
      nb_routes_redondantes: nbRoutesRedondantes,
      nb_sentiers: nbSentiersReels,
      nb_goulots: goulotsCourants.length,
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
