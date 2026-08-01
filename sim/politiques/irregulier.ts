// Irrégulier — présent deux jours sur trois, absent le troisième.
// Les jours d'absence, aucun ordre : les joueurs restent où ils étaient.
// Sinon, comportement assidu (répartition sur les exposés).

import type { JoueurId } from "../../engine/types/garnison.js";
import type { OrdreJoueur } from "../../engine/types/campagne.js";
import type { Politique } from "./types.js";
import { assidu } from "./assidu.js";

export const irregulier: Politique = (entree) => {
  if (entree.jour % 3 === 0) {
    const m = new Map<JoueurId, OrdreJoueur>();
    for (const jid of entree.mes_joueurs) m.set(jid, { type: "aucun_ordre" });
    return m;
  }
  return assidu(entree);
};
