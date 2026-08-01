// Populations livrées pour les campagnes de calibrage.
// Chaque population décrit une DISTRIBUTION de grades et une DISTRIBUTION
// de politiques. La graine de la campagne fixe le nommage des joueurs.

import type { Grade } from "../../engine/types/grade.js";
import type { NomPolitique } from "../politiques/types.js";

export interface SpecJoueur {
  readonly grade: Grade;
  readonly politique: NomPolitique;
  readonly quantite: number;
}

export interface Population {
  readonly nom: string;
  readonly description: string;
  readonly joueurs: readonly SpecJoueur[];
}

/** Assidus purs — la référence de haute qualité. */
export const ASSIDUS_PURS: Population = {
  nom: "assidus_purs",
  description: "Tous assidus. Baseline maximaliste — la province doit tenir.",
  joueurs: [
    { grade: "general", politique: "assidu", quantite: 1 },
    { grade: "capitaine", politique: "assidu", quantite: 2 },
    { grade: "sergent", politique: "assidu", quantite: 4 },
    { grade: "caporal", politique: "assidu", quantite: 6 },
    { grade: "soldat", politique: "assidu", quantite: 8 },
    { grade: "recrue", politique: "assidu", quantite: 10 },
  ],
};

/** Mélange représentatif — cible de calibrage. */
export const MELANGE_REPRESENTATIF: Population = {
  nom: "melange_representatif",
  description:
    "Population attendue en production : majorité assidus, un tiers irréguliers, quelques égoïstes et un déserteur.",
  joueurs: [
    { grade: "general", politique: "assidu", quantite: 1 },
    { grade: "capitaine", politique: "assidu", quantite: 1 },
    { grade: "capitaine", politique: "irregulier", quantite: 1 },
    { grade: "sergent", politique: "assidu", quantite: 2 },
    { grade: "sergent", politique: "irregulier", quantite: 2 },
    { grade: "caporal", politique: "assidu", quantite: 3 },
    { grade: "caporal", politique: "irregulier", quantite: 3 },
    { grade: "soldat", politique: "assidu", quantite: 4 },
    { grade: "soldat", politique: "egoiste", quantite: 2 },
    { grade: "recrue", politique: "assidu", quantite: 6 },
    { grade: "recrue", politique: "deserteur", quantite: 1 },
  ],
};

/** Stress test — beaucoup de déserteurs et d'égoïstes. */
export const STRESS_DESERTEURS: Population = {
  nom: "stress_deserteurs",
  description: "Cas dégradé : la moitié des recrues désertent, les capitaines sont égoïstes.",
  joueurs: [
    { grade: "general", politique: "assidu", quantite: 1 },
    { grade: "capitaine", politique: "egoiste", quantite: 2 },
    { grade: "sergent", politique: "assidu", quantite: 3 },
    { grade: "sergent", politique: "irregulier", quantite: 1 },
    { grade: "caporal", politique: "assidu", quantite: 3 },
    { grade: "caporal", politique: "irregulier", quantite: 2 },
    { grade: "soldat", politique: "assidu", quantite: 5 },
    { grade: "soldat", politique: "deserteur", quantite: 3 },
    { grade: "recrue", politique: "assidu", quantite: 4 },
    { grade: "recrue", politique: "deserteur", quantite: 5 },
  ],
};

export const POPULATIONS: Readonly<Record<string, Population>> = {
  assidus_purs: ASSIDUS_PURS,
  melange_representatif: MELANGE_REPRESENTATIF,
  stress_deserteurs: STRESS_DESERTEURS,
};
