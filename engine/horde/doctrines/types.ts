// Interface commune aux six doctrines.
// Une doctrine est une fonction pure : mêmes entrées, même sortie, toujours.
// Elle n'accède jamais à l'historique — elle ne connaît que le jour, la
// carte, la disposition défensive du jour, et sa graine de lune.

import type { AbordId, Lieu, LieuId, Province } from "../../types/carte.js";
import type { Garnison } from "../../types/garnison.js";
import type { TypeForge, Vague } from "../../types/forge.js";

/** Les six doctrines, énumérées. Ordre stable pour le tirage par graine. */
export const NOMS_DOCTRINES = [
  "marteau",
  "ecorcheurs",
  "meute",
  "rouleau",
  "garde",
  "serpent",
] as const;

export type NomDoctrine = (typeof NOMS_DOCTRINES)[number];

/** Profil de composition d'une doctrine. Somme = 1. */
export type Composition = Readonly<Record<TypeForge, number>>;

/**
 * Contexte remis à une doctrine pour chaque assaut à planifier.
 * La doctrine est appelée UNE fois par jour, reçoit ses fronts déjà attribués
 * (un lieu par front), et produit une Vague par front.
 */
export interface CtxCiblage {
  readonly jour: number;
  readonly graine_lune: bigint;
  readonly province: Province;
  /** Garnison par lieu, index par LieuId. Un lieu absent = garnison vide. */
  readonly garnisons: ReadonlyMap<LieuId, Garnison>;
  /** Volume alloué à chaque front (index parallèle à `fronts`). */
  readonly volumes_par_front: readonly number[];
}

/**
 * Une doctrine : un profil fixe + une règle de préférence + une règle
 * d'abord + une composition. La fonction `planifier` produit une Vague par
 * front attribué.
 */
export interface Doctrine {
  readonly nom: NomDoctrine;
  readonly composition: Composition;
  /**
   * Trie l'ensemble des lieux exposés du plus PRÉFÉRÉ au moins préféré.
   * Utilisé par `orchestrer` pour partitionner les fronts en style « draft ».
   * Départage stable via `LieuId` lexicographique pour la reproductibilité.
   */
  preferer(exposes: readonly LieuId[], ctx: CtxCiblage): readonly LieuId[];
  /**
   * Choisit l'abord ciblé sur un lieu donné, selon la règle de la doctrine.
   */
  choisirAbord(lieu: Lieu, ctx: CtxCiblage): AbordId;
  /**
   * Planifie les vagues du jour à partir des fronts qui lui sont attribués.
   * Une vague par front, composition proportionnelle au volume alloué.
   */
  planifier(fronts: readonly LieuId[], ctx: CtxCiblage): readonly Vague[];
}
