// Volume de la horde — formules de RULES §7.
//
// Fonction pure, sans I/O, sans Date.now. La capacité et la production
// cumulée des Fosses sont mesurées ailleurs (par la couche de persistance)
// et passées en entrée.

import type { Balance } from "../../config/schema.js";
import { puissanceCapacite } from "../math/index.js";

export interface EntreeVolume {
  /** Production cumulée depuis la dernière lune des Fosses tenues par la horde. */
  readonly production_cumulee_fosses: number;
  /** Puissance globale de Varhal, reportée d'une lune à l'autre. */
  readonly puissance_varhal: number;
  /** Capacité mesurée du royaume : Σ (joueurs actifs 7j × poids grade). */
  readonly capacite: number;
  /** Nombre de fronts déjà calculé (voir `calculerNbFronts`). */
  readonly nb_fronts: number;
  readonly config: Balance;
}

/**
 * Volume total du jour, avant répartition entre les fronts.
 *
 * ```
 * volume_base = production_cumulee_fosses × puissance_varhal
 * facteur     = capacite ^ exposant_adaptation_population
 * volume      = clamp( volume_base × facteur, plancher, plafond_par_front × nb_fronts )
 * ```
 *
 * Les offensives de fin d'acte (J10/J20/J30) multiplient ce volume par
 * `horde.multiplicateur_offensive` — ce n'est PAS géré ici : le caller
 * applique la multiplication au niveau de `orchestrer`.
 */
export function calculerVolume(entree: EntreeVolume): number {
  if (entree.nb_fronts < 1) {
    throw new Error("calculerVolume : nb_fronts doit être >= 1");
  }
  const volumeBase = entree.production_cumulee_fosses * entree.puissance_varhal;
  const facteur = puissanceCapacite(entree.capacite);
  const brut = volumeBase * facteur;
  const plancher = entree.config.horde.plancher_intensite;
  const plafond = entree.config.horde.plafond_intensite_par_front * entree.nb_fronts;
  if (brut < plancher) return plancher;
  if (brut > plafond) return plafond;
  return brut;
}
