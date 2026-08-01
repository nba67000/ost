// Concentrateur — POLITIQUE DE DIAGNOSTIC, pas de jeu.
//
// Hypothèse volontairement irréaliste : redéploiement libre et instantané
// chaque jour, connaissance parfaite de la géographie. Sert à mesurer le
// PLAFOND de défense : jusqu'où une garnison jouée parfaitement peut-elle
// tenir face au calibrage actuel de la horde ?
//
// Règles :
//   1. Garnit UNIQUEMENT les lieux exposés — l'arrière reste vide (pas de
//      réserve à la place forte si elle n'est pas exposée).
//   2. Répartit au prorata de la menace attendue par lieu :
//        poids_lieu = 1, ou horde.part_goulot si le lieu est un goulot.
//      Chaque abord d'un lieu reçoit une part égale de l'effectif alloué au
//      lieu — le concentrateur ne peut pas prédire quel abord la doctrine
//      choisira.
//   3. Distribue les joueurs par grade décroissant (plus gros effectifs
//      d'abord) sur l'abord au plus grand déficit relatif — greedy.
//   4. Posture `mur` par défaut sur tous les postes.

import type { JoueurId } from "../../engine/types/garnison.js";
import type { AbordId, LieuId } from "../../engine/types/carte.js";
import type { EtatJoueur, OrdreJoueur } from "../../engine/types/campagne.js";
import type { Politique } from "./types.js";
import { PONDERATION_GRADES } from "../../engine/jour/ponderation.js";
import { lieuxExposes } from "../../engine/horde/exposes.js";
import { detecterGoulots } from "../../engine/carte/goulots.js";

export const concentrateur: Politique = ({ etat, mes_joueurs, jour, config }) => {
  const ordres = new Map<JoueurId, OrdreJoueur>();

  const exposes = lieuxExposes(etat.province.lieux, etat.province.liens, etat.province.entrees);
  if (exposes.length === 0) {
    for (const jid of mes_joueurs) ordres.set(jid, { type: "aucun_ordre" });
    return ordres;
  }

  const lieuParId = new Map(etat.province.lieux.map((l) => [l.id, l]));
  const royaumeIds = new Set(
    etat.province.lieux.filter((l) => l.tenu_par === "royaume").map((l) => l.id),
  );
  const goulots = new Set(
    detecterGoulots(royaumeIds, etat.province.liens, etat.province.place_forte_id),
  );

  // Poids topologique par lieu exposé.
  const partGoulot = config.horde.part_goulot;
  const poidsParLieu = new Map<LieuId, number>();
  for (const lid of exposes) {
    poidsParLieu.set(lid, goulots.has(lid) ? partGoulot : 1);
  }
  const sommePoids = [...poidsParLieu.values()].reduce((a, b) => a + b, 0);

  // Joueurs disponibles = aptes au combat (non blessés OU retour_combat écoulé).
  const dispos: EtatJoueur[] = [];
  for (const jid of mes_joueurs) {
    const j = etat.joueurs.get(jid);
    if (j === undefined) continue;
    if (j.blessure !== null && j.blessure.retour_combat_jour > jour) continue;
    dispos.push(j);
  }
  const effTotal = dispos.reduce((s, j) => s + config.grades.effectif_commande[j.grade], 0);

  // Effectif cible par abord des lieux exposés.
  interface CibleAbord {
    readonly abord_id: AbordId;
    readonly lieu_id: LieuId;
    readonly cible: number;
    courant: number;
  }
  const cibles: CibleAbord[] = [];
  for (const lid of exposes) {
    const lieu = lieuParId.get(lid);
    if (lieu === undefined || lieu.abords.length === 0) continue;
    const effCibleLieu = effTotal * (poidsParLieu.get(lid)! / sommePoids);
    const parAbord = effCibleLieu / lieu.abords.length;
    for (const a of lieu.abords) {
      cibles.push({ abord_id: a.id, lieu_id: lid, cible: parAbord, courant: 0 });
    }
  }

  if (cibles.length === 0) {
    for (const j of dispos) ordres.set(j.id, { type: "aucun_ordre" });
    return ordres;
  }

  // Trier joueurs par grade décroissant (plus gros effectifs d'abord).
  const dispoSorted = [...dispos].sort((a, b) => {
    const dGrade = PONDERATION_GRADES.indexOf(b.grade) - PONDERATION_GRADES.indexOf(a.grade);
    if (dGrade !== 0) return dGrade;
    return (a.id as string).localeCompare(b.id as string, "en");
  });

  // Greedy : chaque joueur va à l'abord au plus grand déficit (cible - courant).
  for (const j of dispoSorted) {
    let meilleur: CibleAbord | null = null;
    let meilleurDef = Number.NEGATIVE_INFINITY;
    for (const c of cibles) {
      const def = c.cible - c.courant;
      if (
        def > meilleurDef ||
        (def === meilleurDef &&
          meilleur !== null &&
          (c.abord_id as string) < (meilleur.abord_id as string))
      ) {
        meilleur = c;
        meilleurDef = def;
      }
    }
    if (meilleur === null) {
      ordres.set(j.id, { type: "aucun_ordre" });
      continue;
    }
    ordres.set(j.id, {
      type: "affecter",
      lieu_id: meilleur.lieu_id,
      abord_id: meilleur.abord_id,
      posture: "mur",
    });
    meilleur.courant += config.grades.effectif_commande[j.grade];
  }

  return ordres;
};
