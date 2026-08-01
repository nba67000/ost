// Déserteur — assidu jusqu'au jour 7 inclus, silencieux à partir du jour 8.
// À partir du jour 8, aucun ordre : les joueurs restent figés là où ils
// étaient au moment de la désertion.
//
// Effet observable : la ligne se cristallise et ne s'adapte plus.
// Contrairement à l'irrégulier, la désertion est PERMANENTE.

import type { JoueurId } from "../../engine/types/garnison.js";
import type { OrdreJoueur } from "../../engine/types/campagne.js";
import type { Politique } from "./types.js";
import { assidu } from "./assidu.js";

const JOUR_DESERTION = 8;

export const deserteur: Politique = (entree) => {
  if (entree.jour >= JOUR_DESERTION) {
    const m = new Map<JoueurId, OrdreJoueur>();
    for (const jid of entree.mes_joueurs) m.set(jid, { type: "aucun_ordre" });
    return m;
  }
  return assidu(entree);
};
