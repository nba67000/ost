// Égoïste — ne se déplace pas pour aider les autres.
// Ses joueurs restent à la place forte (ou en réserve globale à la PF).
// Il ne va jamais renforcer un feu de guet ou un poste avancé exposé.
//
// Effet observable en simulation : les périphériques tombent plus vite
// quand la population contient beaucoup d'égoïstes.

import type { JoueurId } from "../../engine/types/garnison.js";
import type { OrdreJoueur } from "../../engine/types/campagne.js";
import type { Politique } from "./types.js";
import { PONDERATION_GRADES } from "../../engine/jour/ponderation.js";

export const egoiste: Politique = ({ etat, mes_joueurs }) => {
  const ordres = new Map<JoueurId, OrdreJoueur>();
  const pf = etat.province.lieux.find((l) => l.id === etat.province.place_forte_id);
  if (pf === undefined) {
    for (const jid of mes_joueurs) ordres.set(jid, { type: "aucun_ordre" });
    return ordres;
  }
  // Les joueurs vont sur les abords de la PF (grade élevé en priorité),
  // le reste en réserve.
  const dispos = mes_joueurs
    .map((jid) => etat.joueurs.get(jid))
    .filter(
      (j): j is import("../../engine/types/campagne.js").EtatJoueur =>
        j !== undefined && j.blessure === null,
    )
    .sort(
      (a, b) =>
        PONDERATION_GRADES.indexOf(b.grade) - PONDERATION_GRADES.indexOf(a.grade) ||
        (a.id as string).localeCompare(b.id as string, "en"),
    );
  const abords = [...pf.abords].sort((a, b) =>
    (a.id as string).localeCompare(b.id as string, "en"),
  );
  for (let i = 0; i < dispos.length; i++) {
    const j = dispos[i]!;
    if (i < abords.length) {
      ordres.set(j.id, {
        type: "affecter",
        lieu_id: pf.id,
        abord_id: abords[i]!.id,
        posture: "mur",
      });
    } else {
      ordres.set(j.id, { type: "reserve", lieu_id: pf.id });
    }
  }
  return ordres;
};
