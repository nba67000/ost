// Interface commune aux robots de simulation.
// Une politique gère un SOUS-ENSEMBLE de joueurs (les "siens") et produit
// leurs ordres pour le prochain assaut. Différentes politiques ne se
// coordonnent pas entre elles.
//
// Les politiques sont des fonctions PURES : mêmes entrées, même sortie.

import type { Balance } from "../../config/schema.js";
import type { JoueurId } from "../../engine/types/garnison.js";
import type { EtatCampagne, OrdreJoueur } from "../../engine/types/campagne.js";

export type NomPolitique = "assidu" | "irregulier" | "egoiste" | "deserteur" | "concentrateur";

export interface EntreePolitique {
  readonly etat: EtatCampagne;
  readonly mes_joueurs: readonly JoueurId[];
  readonly jour: number;
  readonly config: Balance;
}

export type Politique = (entree: EntreePolitique) => ReadonlyMap<JoueurId, OrdreJoueur>;
