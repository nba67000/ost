// Fronts du jour — combien et lesquels.
// RULES §7 : « nb_fronts = clamp( round( capacite^exp / diviseur ), 1, nb_lieux_exposes ) »
//
// La fonction ne DÉCIDE PAS quels lieux exposés deviennent fronts : c'est
// l'affaire des doctrines qui, en ordre de graine, se disputent le pool des
// exposés. `calculerNbFronts` fournit seulement la contrainte de cardinalité.

import type { Balance } from "../../config/schema.js";
import { puissanceCapacite } from "../math/index.js";

/**
 * Nombre de fronts pour un jour ordinaire (hors offensive de fin d'acte).
 *
 * La formule est identique à celle qui régit `volume` : la charge se
 * traduit en ÉTALEMENT plutôt qu'en puissance. Sur une carte à peu
 * d'exposés, le clamp haut mord tôt.
 *
 * Retourne 0 si `nb_lieux_exposes = 0` — aucune attaque n'est possible.
 */
export function calculerNbFronts(
  capacite: number,
  nb_lieux_exposes: number,
  config: Balance,
): number {
  if (nb_lieux_exposes <= 0) return 0;
  const facteur = puissanceCapacite(capacite);
  const brut = Math.round(facteur / config.horde.diviseur_fronts);
  if (brut < 1) return 1;
  if (brut > nb_lieux_exposes) return nb_lieux_exposes;
  return brut;
}
