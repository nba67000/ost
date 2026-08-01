// Réactif — politique de DIAGNOSTIC (RULES §4 : déplacement de garnison).
//
// Chaque jour, mesure les lieux exposés du JOUR et redéploie vers eux via
// des ordres `deplacer`. Un joueur reçu l'ordre le jour N n'arrive qu'au
// jour N+1 (route) : le réactif arrive donc systématiquement UN JOUR
// APRÈS que l'exposition a été mesurée.
//
// Sert de baseline face au prévoyant. L'écart entre les deux est la valeur
// de l'information dans le jeu.

import type { JoueurId } from "../../engine/types/garnison.js";
import type { OrdreJoueur, EtatJoueur } from "../../engine/types/campagne.js";
import type { LieuId } from "../../engine/types/carte.js";
import type { Politique } from "./types.js";
import { PONDERATION_GRADES } from "../../engine/jour/ponderation.js";
import { lieuxExposes } from "../../engine/horde/exposes.js";
import { detecterGoulots } from "../../engine/carte/goulots.js";
import { abordPrioritaire, lieuActuel, prochainSaut } from "./deplacement.js";

export const reactif: Politique = ({ etat, mes_joueurs, jour, config }) => {
  const exposes = lieuxExposes(etat.province.lieux, etat.province.liens, etat.province.entrees);
  return distribuerVersCibles(etat, mes_joueurs, jour, config, exposes);
};

// --- Helper partagé avec le prévoyant (paramétré par les cibles) ---------

import type { Balance } from "../../config/schema.js";
import type { EtatCampagne } from "../../engine/types/campagne.js";

export function distribuerVersCibles(
  etat: EtatCampagne,
  mes_joueurs: readonly JoueurId[],
  jour: number,
  config: Balance,
  cibles: readonly LieuId[],
): Map<JoueurId, OrdreJoueur> {
  const ordres = new Map<JoueurId, OrdreJoueur>();
  if (cibles.length === 0) {
    for (const jid of mes_joueurs) ordres.set(jid, { type: "aucun_ordre" });
    return ordres;
  }

  const royaumeIds = new Set(
    etat.province.lieux.filter((l) => l.tenu_par === "royaume").map((l) => l.id),
  );
  const goulots = new Set(
    detecterGoulots(royaumeIds, etat.province.liens, etat.province.place_forte_id),
  );
  const partGoulot = config.horde.part_goulot;

  const poidsParCible = new Map<LieuId, number>();
  for (const lid of cibles) {
    if (!royaumeIds.has(lid)) continue;
    poidsParCible.set(lid, goulots.has(lid) ? partGoulot : 1);
  }
  const sommePoids = [...poidsParCible.values()].reduce((a, b) => a + b, 0);
  if (sommePoids === 0) {
    for (const jid of mes_joueurs) ordres.set(jid, { type: "aucun_ordre" });
    return ordres;
  }

  // Joueurs disponibles : aptes au combat ET pas en transit.
  const dispos: EtatJoueur[] = [];
  for (const jid of mes_joueurs) {
    const j = etat.joueurs.get(jid);
    if (j === undefined) continue;
    if (j.blessure !== null && j.blessure.retour_combat_jour > jour) continue;
    if (j.transit !== null && j.transit.arrivee_jour > jour) continue;
    dispos.push(j);
  }

  // Effectif alloué à chaque cible (répartition à l'échelle du LIEU, la
  // distribution sur ses abords sera choisie à l'arrivée par une action
  // `affecter`).
  const effTotal = dispos.reduce((s, j) => s + config.grades.effectif_commande[j.grade], 0);
  const cibleParLieu = new Map<LieuId, { cible: number; courant: number }>();
  for (const [lid, poids] of poidsParCible) {
    cibleParLieu.set(lid, { cible: effTotal * (poids / sommePoids), courant: 0 });
  }

  // Joueurs les plus gros d'abord (grade décroissant, départage lex).
  const trie = [...dispos].sort((a, b) => {
    const dg = PONDERATION_GRADES.indexOf(b.grade) - PONDERATION_GRADES.indexOf(a.grade);
    if (dg !== 0) return dg;
    return (a.id as string).localeCompare(b.id as string, "en");
  });

  for (const j of trie) {
    // Choisit la cible au plus grand déficit (relatif : cible − courant).
    let meilleureCible: LieuId | null = null;
    let meilleurDef = Number.NEGATIVE_INFINITY;
    for (const [lid, s] of cibleParLieu) {
      const def = s.cible - s.courant;
      if (
        def > meilleurDef ||
        (def === meilleurDef &&
          meilleureCible !== null &&
          (lid as string) < (meilleureCible as string))
      ) {
        meilleureCible = lid;
        meilleurDef = def;
      }
    }
    if (meilleureCible === null) {
      ordres.set(j.id, { type: "aucun_ordre" });
      continue;
    }
    const positionJoueur = lieuActuel(j.id, etat.garnisons);
    if (positionJoueur === meilleureCible) {
      // Déjà sur place : garnit l'abord prioritaire.
      const abord = abordPrioritaire(meilleureCible, etat.province);
      if (abord === null) {
        ordres.set(j.id, { type: "reserve", lieu_id: meilleureCible });
      } else {
        ordres.set(j.id, {
          type: "affecter",
          lieu_id: meilleureCible,
          abord_id: abord,
          posture: "mur",
        });
      }
    } else if (positionJoueur !== null) {
      // Un saut vers la cible.
      const saut = prochainSaut(positionJoueur, meilleureCible, etat.province);
      if (saut === null) {
        // Pas de chemin — reste en réserve du lieu courant.
        ordres.set(j.id, { type: "reserve", lieu_id: positionJoueur });
      } else {
        ordres.set(j.id, { type: "deplacer", vers_lieu_id: saut });
      }
    } else {
      // Joueur nulle part (nouveau ou en transit non-résolu ce jour).
      ordres.set(j.id, { type: "aucun_ordre" });
    }
    cibleParLieu.get(meilleureCible)!.courant += config.grades.effectif_commande[j.grade];
  }

  return ordres;
}
