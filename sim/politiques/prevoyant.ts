// Prévoyant — politique de DIAGNOSTIC (RULES §4 : déplacement de garnison).
//
// Anticipe les lieux qui SERONT exposés le lendemain à partir de la
// géographie observable : si un exposé tombe, ses voisins royaume
// deviennent à leur tour exposés. Le prévoyant garnit donc à la fois les
// exposés actuels ET leurs voisins royaume — l'expansion à un hop.
//
// Sur une route (arrivée à J+1), le joueur qui part aujourd'hui vers un
// exposé anticipé sera en place quand la horde y arrivera. C'est là que
// se joue la valeur du renseignement.

import type { LieuId } from "../../engine/types/carte.js";
import type { Politique } from "./types.js";
import { lieuxExposes } from "../../engine/horde/exposes.js";
import { distribuerVersCibles } from "./reactif.js";

export const prevoyant: Politique = ({ etat, mes_joueurs, jour, config }) => {
  const exposesAujourdhui = new Set<LieuId>(
    lieuxExposes(etat.province.lieux, etat.province.liens, etat.province.entrees),
  );
  // Expansion à un hop : voisins royaume des exposés actuels.
  const royaume = new Set(
    etat.province.lieux.filter((l) => l.tenu_par === "royaume").map((l) => l.id),
  );
  const cibles = new Set<LieuId>(exposesAujourdhui);
  for (const lien of etat.province.liens) {
    if (exposesAujourdhui.has(lien.a) && royaume.has(lien.b)) cibles.add(lien.b);
    if (exposesAujourdhui.has(lien.b) && royaume.has(lien.a)) cibles.add(lien.a);
  }
  return distribuerVersCibles(etat, mes_joueurs, jour, config, [...cibles]);
};
