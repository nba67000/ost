// Volume de la horde — formules de RULES §7.
//
// La formule est ancrée sur l'EFFECTIF TOTAL du royaume (Σ effectif_commande
// des joueurs actifs), pas sur la garnison réellement présente à un lieu :
// le volume ennemi ne doit jamais dépendre de ce que le joueur a choisi de
// mettre où — sinon renforcer une position n'apporte rien.
//
// Fonction pure, sans I/O, sans Date.now.

import type { Balance } from "../../config/schema.js";
import { puissanceCapacite } from "../math/index.js";

export interface EntreeVolume {
  /** Production cumulée depuis la dernière lune des Fosses tenues par la horde. */
  readonly production_cumulee_fosses: number;
  /** Puissance globale de Varhal, reportée d'une lune à l'autre. */
  readonly puissance_varhal: number;
  /**
   * Σ des `effectif_commande[grade]` de tous les joueurs actifs (présents,
   * non blessés). Ce nombre définit à la fois l'échelle du volume ennemi et
   * les bornes plancher/plafond du jour.
   */
  readonly effectif_total_royaume: number;
  readonly config: Balance;
}

/**
 * Volume total du jour, avant répartition entre les fronts.
 *
 * ```
 * volume_base = pression_base × production_cumulee_fosses × puissance_varhal
 * facteur     = effectif_total_royaume ^ exposant_adaptation_population
 * volume      = clamp( volume_base × facteur,
 *                      plancher_coef × effectif_total_royaume,
 *                      plafond_coef  × effectif_total_royaume )
 * ```
 *
 * Les coefficients `plancher_coef` et `plafond_coef` se lisent contre les
 * ratios de bascule du banc de combat : 1.06 pour un abord nu, 1.48 pour
 * un feu de guet fortifié, 2.0-2.4 pour la place forte. `plafond_coef = 2.5`
 * signifie que la horde peut au pire monter au niveau qui bascule la place
 * forte ; `plancher_coef = 0.6` signifie qu'elle harcèle même au plus faible.
 *
 * Les offensives de fin d'acte (J10/J20/J30) multiplient ce volume par
 * `horde.multiplicateur_offensive` — appliqué par le caller au niveau de
 * `orchestrer`.
 */
export function calculerVolume(entree: EntreeVolume): number {
  const config = entree.config;
  const effectifTotal = entree.effectif_total_royaume;
  if (effectifTotal <= 0) return 0;
  const volumeBase =
    config.horde.pression_base * entree.production_cumulee_fosses * entree.puissance_varhal;
  const facteur = puissanceCapacite(effectifTotal);
  const brut = volumeBase * facteur;
  const plancher = config.horde.plancher_coef * effectifTotal;
  const plafond = config.horde.plafond_coef * effectifTotal;
  if (brut < plancher) return plancher;
  if (brut > plafond) return plafond;
  return brut;
}
