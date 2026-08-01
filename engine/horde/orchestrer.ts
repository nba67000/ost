// Orchestration d'un jour de horde.
//
// Étapes :
//  1. Recenser les lieux exposés.
//  2. Décider `nb_fronts` (voir `calculerNbFronts`).
//  3. Répartir les volumes par front : au prorata topologique, avec bonus
//     goulot (`horde.part_goulot`).
//  4. Décider les fronts effectifs : chaque doctrine active pioche parmi
//     les exposés dans son ordre de préférence, en style « draft », dans un
//     ordre de doctrines dérivé de la graine.
//  5. Chaque doctrine produit une vague par front alloué.
//
// Cas particulier — offensive de fin d'acte (J10/J20/J30) :
//  - volume ×`horde.multiplicateur_offensive`
//  - tous les exposés attaqués
//  - un seul lieutenant prend la main : `doctrines_actives[acte - 1]`
//
// Aucune I/O. Aucune consultation d'historique. Volume, capacité, exposés
// et garnisons sont tous fournis en entrée.

import type { Balance } from "../../config/schema.js";
import type { LieuId, Province } from "../types/carte.js";
import type { Garnison } from "../types/garnison.js";
import type { Vague } from "../types/forge.js";
import { creerRng } from "../rng/index.js";
import { lieuxExposes } from "./exposes.js";
import { DOCTRINES, tirerDoctrinesLune, type NomDoctrine } from "./doctrines/index.js";
import { detecterGoulots } from "../carte/goulots.js";

export interface EntreeJourHorde {
  readonly jour: number;
  readonly graine_lune: bigint;
  readonly province: Province;
  readonly garnisons: ReadonlyMap<LieuId, Garnison>;
  /** Volume TOTAL du jour, ordinaire (avant multiplicateur d'offensive). */
  readonly volume_total: number;
  /**
   * Nombre de fronts pour un jour ORDINAIRE. Calculé en amont via
   * `calculerNbFronts`. Ignoré les jours d'offensive (tous les exposés).
   */
  readonly nb_fronts: number;
  /** Doctrines actives de la lune. Si omis, tirées à partir de `graine_lune`. */
  readonly doctrines_actives?: readonly NomDoctrine[];
  readonly config: Balance;
}

export interface SortieJourHorde {
  readonly vagues: readonly Vague[];
  /** Doctrines effectivement à la manœuvre ce jour (une liste par vague). */
  readonly doctrines_par_vague: readonly NomDoctrine[];
  readonly est_offensive: boolean;
}

const JOURS_OFFENSIVE: readonly number[] = [10, 20, 30];
const DUREE_ACTE_JOURS = 10;

/**
 * Point d'entrée du jour. Détermine offensive/jour ordinaire, partitionne les
 * fronts, appelle chaque doctrine.
 */
export function orchestrerJour(entree: EntreeJourHorde): SortieJourHorde {
  const config = entree.config;
  const exposes = lieuxExposes(
    entree.province.lieux,
    entree.province.liens,
    entree.province.entrees,
  );
  if (exposes.length === 0) {
    return { vagues: [], doctrines_par_vague: [], est_offensive: false };
  }

  const doctrinesActives =
    entree.doctrines_actives ?? tirerDoctrinesLune(entree.graine_lune, config);
  if (doctrinesActives.length === 0) {
    return { vagues: [], doctrines_par_vague: [], est_offensive: false };
  }

  const estOffensive = JOURS_OFFENSIVE.includes(entree.jour);

  // --- Offensive de fin d'acte -------------------------------------------
  if (estOffensive) {
    const acte = Math.floor((entree.jour - 1) / DUREE_ACTE_JOURS); // 0, 1 ou 2
    const lieutenant = doctrinesActives[acte % doctrinesActives.length]!;
    const volumeAmpli = entree.volume_total * config.horde.multiplicateur_offensive;
    // Tous les exposés attaqués, dans l'ordre de préférence du lieutenant.
    const ordonne = DOCTRINES[lieutenant].preferer(exposes, {
      jour: entree.jour,
      graine_lune: entree.graine_lune,
      province: entree.province,
      garnisons: entree.garnisons,
      volumes_par_front: [],
    });
    const volumes = repartirVolumes(ordonne, volumeAmpli, entree.province, config);
    const vagues = DOCTRINES[lieutenant].planifier(ordonne, {
      jour: entree.jour,
      graine_lune: entree.graine_lune,
      province: entree.province,
      garnisons: entree.garnisons,
      volumes_par_front: volumes,
    });
    return {
      vagues,
      doctrines_par_vague: vagues.map(() => lieutenant),
      est_offensive: true,
    };
  }

  // --- Jour ordinaire ----------------------------------------------------
  const nbFronts = clamp(entree.nb_fronts, 1, exposes.length);

  // Ordre des doctrines pour la draft (dérivé de la graine du jour).
  const ordreDoctrines = ordonnerDoctrines(doctrinesActives, entree.graine_lune, entree.jour);

  // Draft snake : chaque doctrine pioche à tour de rôle.
  const attribution = new Map<NomDoctrine, LieuId[]>();
  for (const d of ordreDoctrines) attribution.set(d, []);
  const disponibles = new Set<LieuId>(exposes);
  let tour = 0;
  while (disponibles.size > 0 && sommeAttributions(attribution) < nbFronts) {
    const doctrineNom = ordreDoctrines[tour % ordreDoctrines.length]!;
    const doctrine = DOCTRINES[doctrineNom];
    const restant = [...disponibles];
    const ordonne = doctrine.preferer(restant, {
      jour: entree.jour,
      graine_lune: entree.graine_lune,
      province: entree.province,
      garnisons: entree.garnisons,
      volumes_par_front: [],
    });
    const choix = ordonne[0]!;
    attribution.get(doctrineNom)!.push(choix);
    disponibles.delete(choix);
    tour++;
  }

  // Répartition des volumes par lieu attaqué.
  const tousFronts: LieuId[] = [];
  for (const d of ordreDoctrines) for (const l of attribution.get(d)!) tousFronts.push(l);
  const volumesGlobal = repartirVolumes(tousFronts, entree.volume_total, entree.province, config);
  const volumesParFront = new Map<LieuId, number>();
  for (let i = 0; i < tousFronts.length; i++) {
    volumesParFront.set(tousFronts[i]!, volumesGlobal[i]!);
  }

  // Chaque doctrine planifie ses vagues.
  const vagues: Vague[] = [];
  const doctrinesParVague: NomDoctrine[] = [];
  for (const d of ordreDoctrines) {
    const fronts = attribution.get(d)!;
    if (fronts.length === 0) continue;
    const volumes = fronts.map((l) => volumesParFront.get(l)!);
    const nouvelles = DOCTRINES[d].planifier(fronts, {
      jour: entree.jour,
      graine_lune: entree.graine_lune,
      province: entree.province,
      garnisons: entree.garnisons,
      volumes_par_front: volumes,
    });
    for (const v of nouvelles) {
      vagues.push(v);
      doctrinesParVague.push(d);
    }
  }
  return { vagues, doctrines_par_vague: doctrinesParVague, est_offensive: false };
}

// --- Helpers ---------------------------------------------------------------

function ordonnerDoctrines(
  actives: readonly NomDoctrine[],
  graine_lune: bigint,
  jour: number,
): readonly NomDoctrine[] {
  const rng = creerRng(graine_lune).deriver(`draft:${jour}`);
  const copie = [...actives];
  for (let i = copie.length - 1; i > 0; i--) {
    const j = rng.entier(0, i);
    const tmp = copie[i]!;
    copie[i] = copie[j]!;
    copie[j] = tmp;
  }
  return copie;
}

function sommeAttributions(m: ReadonlyMap<NomDoctrine, readonly LieuId[]>): number {
  let s = 0;
  for (const v of m.values()) s += v.length;
  return s;
}

/**
 * Répartit un volume total entre plusieurs fronts au prorata de leur
 * importance topologique. Un goulot reçoit `part_goulot` fois plus qu'un
 * non-goulot. Les parts sont ensuite normalisées.
 */
function repartirVolumes(
  fronts: readonly LieuId[],
  volume_total: number,
  province: Province,
  config: Balance,
): readonly number[] {
  if (fronts.length === 0) return [];
  const royaumeIds = new Set(
    province.lieux.filter((l) => l.tenu_par === "royaume").map((l) => l.id),
  );
  const goulots = new Set(detecterGoulots(royaumeIds, province.liens, province.place_forte_id));
  const poidsGoulot = config.horde.part_goulot;
  const poids = fronts.map((id) => (goulots.has(id) ? poidsGoulot : 1));
  const somme = poids.reduce((a, b) => a + b, 0);
  return poids.map((p) => (volume_total * p) / somme);
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
