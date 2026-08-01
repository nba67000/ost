// Adaptateurs entre l'état de campagne (Garnison + joueurs) et les entrées/
// sorties de resoudreAssaut.

import type { Balance } from "../../config/schema.js";
import type { AbordId, Abord, Lieu } from "../types/carte.js";
import type { Garnison, PaquetGarnison } from "../types/garnison.js";
import type { EtatJoueur } from "../types/campagne.js";
import type { JoueurId } from "../types/garnison.js";
import type { Grade } from "../types/grade.js";
import type { TypeForge, Vague } from "../types/forge.js";
import type { EtatAbord, EtatRound, EtatReserve } from "../combat/round.js";
import { PONDERATION_GRADES } from "./ponderation.js";

/**
 * Voisins d'anneau : chaque abord touche l'abord précédent et l'abord suivant
 * dans l'ordre du `index_anneau`. Un lieu à un seul abord n'a pas de voisin.
 */
export function voisinsAnneau(abords: readonly Abord[]): Map<AbordId, AbordId[]> {
  const tri = [...abords].sort((a, b) => a.index_anneau - b.index_anneau);
  const m = new Map<AbordId, AbordId[]>();
  const n = tri.length;
  for (let i = 0; i < n; i++) {
    if (n === 1) {
      m.set(tri[i]!.id, []);
      continue;
    }
    const prec = tri[(i - 1 + n) % n]!.id;
    const suiv = tri[(i + 1) % n]!.id;
    if (n === 2) {
      m.set(tri[i]!.id, [tri[(i + 1) % 2]!.id]);
    } else {
      m.set(tri[i]!.id, [prec, suiv]);
    }
  }
  return m;
}

/**
 * Grade dominant d'un paquet — le plus élevé parmi ses joueurs.
 * Retourne `recrue` par défaut si le paquet est vide.
 */
function gradeDominant(paquet: PaquetGarnison, joueurs: ReadonlyMap<JoueurId, EtatJoueur>): Grade {
  const ordre: Grade[] = ["recrue", "soldat", "caporal", "sergent", "capitaine", "general"];
  let meilleur: Grade = "recrue";
  let meilleurIdx = 0;
  for (const jid of paquet.joueurs) {
    const j = joueurs.get(jid);
    if (j === undefined) continue;
    const idx = ordre.indexOf(j.grade);
    if (idx > meilleurIdx) {
      meilleur = j.grade;
      meilleurIdx = idx;
    }
  }
  return meilleur;
}

/**
 * Coefficient d'usure moyen d'un paquet — moyenne pondérée de
 * `usure_restante / usure_batailles_neuf`, clampée à
 * `[modificateurs.usure_equipement_min, 1]`.
 *
 * Représente l'idée : plus l'équipement est usé, moins la force effective
 * de la troupe est haute. Un équipement à 0 batailles restantes est cassé
 * — d'où le plancher.
 */
function coefUsurePaquet(
  paquet: PaquetGarnison,
  joueurs: ReadonlyMap<JoueurId, EtatJoueur>,
  config: Balance,
): number {
  if (paquet.joueurs.length === 0) return 1;
  const neuf = config.economie.usure_batailles_neuf;
  const plancher = config.combat.modificateurs.usure_equipement_min;
  let somme = 0;
  let n = 0;
  for (const jid of paquet.joueurs) {
    const j = joueurs.get(jid);
    if (j === undefined) continue;
    const ratio = neuf > 0 ? Math.max(0, j.usure_restante) / neuf : 1;
    somme += ratio;
    n++;
  }
  if (n === 0) return 1;
  const moy = somme / n;
  return Math.max(plancher, Math.min(1, moy));
}

/**
 * Construit un EtatAbord (entrée round) à partir d'un abord de carte et
 * du paquet qui l'occupe. Un abord sans paquet reçoit un effectif nul et
 * une posture par défaut `mur`.
 */
export function construireEtatAbord(
  abord: Abord,
  lieu: Lieu,
  garnison: Garnison,
  joueurs: ReadonlyMap<JoueurId, EtatJoueur>,
  ravitaillement_coef: number,
  voisinsMap: ReadonlyMap<AbordId, readonly AbordId[]>,
  config: Balance,
): EtatAbord {
  const paquets = garnison.paquets.filter((p) => p.abord_id === abord.id);
  const effectif = paquets.reduce((s, p) => s + p.effectif, 0);
  // Un seul paquet actif retenu pour la posture ; si plusieurs, on prend le
  // plus grand. Cas normal en sim : un seul paquet par abord.
  const paquetDominant =
    paquets.length === 0 ? null : paquets.reduce((a, b) => (a.effectif >= b.effectif ? a : b));

  const terrainFortif = config.terrain[lieu.terrain]?.fortification ?? 1;

  return {
    abord_id: abord.id,
    effectif,
    effectif_initial_assaut: effectif,
    posture: paquetDominant?.posture ?? "mur",
    voisins: voisinsMap.get(abord.id) ?? [],
    fortification_niveau: abord.fortification,
    terrain_fortification: terrainFortif,
    ravitaillement_coef,
    fatigue_coef: 1,
    usure_coef: paquetDominant === null ? 1 : coefUsurePaquet(paquetDominant, joueurs, config),
    preparation_coef: 1,
    commandant_grade: paquetDominant === null ? "recrue" : gradeDominant(paquetDominant, joueurs),
    rompu: false,
    flanque_ce_round: false,
    reserve_recente: false,
  };
}

/**
 * Effectif total d'une réserve = Σ effectif_commande des joueurs en réserve.
 * Grade dominant = le plus élevé parmi eux.
 */
export function construireEtatReserve(
  garnison: Garnison,
  joueurs: ReadonlyMap<JoueurId, EtatJoueur>,
  config: Balance,
): EtatReserve {
  let effectif = 0;
  let gradeIdx = 0;
  const ordre: Grade[] = ["recrue", "soldat", "caporal", "sergent", "capitaine", "general"];
  let grade: Grade = "recrue";
  for (const jid of garnison.reserve) {
    const j = joueurs.get(jid);
    if (j === undefined) continue;
    effectif += config.grades.effectif_commande[j.grade];
    const idx = ordre.indexOf(j.grade);
    if (idx > gradeIdx) {
      grade = j.grade;
      gradeIdx = idx;
    }
  }
  return { effectif, effectif_initial_assaut: effectif, commandant_grade: grade };
}

/**
 * Compose l'EtatRound initial d'un assaut sur un lieu donné.
 */
export function construireEtatRound(
  lieu: Lieu,
  garnison: Garnison,
  joueurs: ReadonlyMap<JoueurId, EtatJoueur>,
  ravitaillement_coef: number,
  config: Balance,
): EtatRound {
  const voisinsMap = voisinsAnneau(lieu.abords);
  const abordsEtat = lieu.abords.map((a) =>
    construireEtatAbord(a, lieu, garnison, joueurs, ravitaillement_coef, voisinsMap, config),
  );
  return {
    lieu_id: lieu.id,
    numero_round: 1,
    abords: abordsEtat,
    reserve: construireEtatReserve(garnison, joueurs, config),
  };
}

/**
 * Répartit la composition d'une Vague sur les abords selon un profil trivial :
 * TOUT sur l'abord ciblé par la vague. Une doctrine ne « feint » pas en v1 —
 * elle frappe où elle a annoncé.
 */
export function vaguesParRound(
  vague: Vague,
  rounds_max: number,
): Map<number, Map<AbordId, Readonly<Record<TypeForge, number>>>> {
  const m = new Map<number, Map<AbordId, Readonly<Record<TypeForge, number>>>>();
  // Volume total étalé également sur les rounds — modèle simple v1.
  const parRound: Record<TypeForge, number> = {
    souche: Math.floor(vague.composition.souche / rounds_max),
    ecorcheur: Math.floor(vague.composition.ecorcheur / rounds_max),
    belier: Math.floor(vague.composition.belier / rounds_max),
    chien_de_fosse: Math.floor(vague.composition.chien_de_fosse / rounds_max),
    muet: Math.floor(vague.composition.muet / rounds_max),
  };
  for (let r = 1; r <= rounds_max; r++) {
    const parAbord = new Map<AbordId, Readonly<Record<TypeForge, number>>>();
    parAbord.set(vague.abord_id, parRound);
    m.set(r, parAbord);
  }
  return m;
}

export { PONDERATION_GRADES };

/**
 * Effectif total commandé par un joueur, selon son grade.
 */
export function effectifJoueur(j: EtatJoueur, config: Balance): number {
  return config.grades.effectif_commande[j.grade];
}
