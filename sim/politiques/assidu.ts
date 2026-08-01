// Assidu — répartit correctement et fortifie.
//
// Priorité aux lieux exposés. Sur chaque abord exposé, on empile les joueurs
// par grade décroissant tant qu'on n'a pas atteint une couverture cible.
// Ce qui reste va en réserve à la place forte.
//
// Posture par défaut : `mur` (couvre bien souche et chien_de_fosse, les
// deux compositions les plus fréquentes en début de campagne). Simple mais
// solide — le contrepoint de la sophistication.

import type { JoueurId } from "../../engine/types/garnison.js";
import type { OrdreJoueur } from "../../engine/types/campagne.js";
import type { Politique } from "./types.js";
import { PONDERATION_GRADES } from "../../engine/jour/ponderation.js";
import { lieuxExposes } from "../../engine/horde/exposes.js";

export const assidu: Politique = ({ etat, mes_joueurs, config }) => {
  const ordres = new Map<JoueurId, OrdreJoueur>();

  const exposes = lieuxExposes(etat.province.lieux, etat.province.liens, etat.province.entrees);
  const lieuxParId = new Map(etat.province.lieux.map((l) => [l.id, l]));

  // Liste des cibles : (lieu, abord, priorité). Priorité = fortification
  // décroissante (les points durs veulent le plus de renforts, parce qu'un
  // renfort sur un abord fortifié donne plus de force effective).
  interface Cible {
    lieu_id: import("../../engine/types/carte.js").LieuId;
    abord_id: import("../../engine/types/carte.js").AbordId;
    priorite: number;
  }
  const cibles: Cible[] = [];
  for (const lid of exposes) {
    const lieu = lieuxParId.get(lid);
    if (lieu === undefined) continue;
    for (const a of lieu.abords) {
      cibles.push({ lieu_id: lid, abord_id: a.id, priorite: a.fortification });
    }
  }
  cibles.sort(
    (a, b) =>
      b.priorite - a.priorite || (a.abord_id as string).localeCompare(b.abord_id as string, "en"),
  );

  // Tri des joueurs disponibles par grade décroissant.
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

  // Distribution round-robin sur les abords.
  const totalDispos = dispos.length;
  const partReserve = Math.floor(totalDispos * config.combat.part_reserve_max);
  const partLigne = totalDispos - partReserve;

  for (let i = 0; i < dispos.length; i++) {
    const j = dispos[i]!;
    if (i < partLigne && cibles.length > 0) {
      const c = cibles[i % cibles.length]!;
      ordres.set(j.id, {
        type: "affecter",
        lieu_id: c.lieu_id,
        abord_id: c.abord_id,
        posture: "mur",
      });
    } else {
      ordres.set(j.id, { type: "reserve", lieu_id: etat.province.place_forte_id });
    }
  }

  return ordres;
};
