// État persistant d'une simulation de campagne.
// Voir RULES §2 (temps) et §9 (blessures).
//
// Immuable au sens intention : les fonctions pures d'engine/jour reçoivent
// un EtatCampagne et retournent le suivant. Les Map sont volontairement
// laissés Map (pas ReadonlyMap) pour éviter le poids de la copie
// défensive à chaque étape — l'invariant tient parce que le seul appelant
// est avancerJour, qui construit un nouvel état complet avant de le rendre.

import type { LieuId, Province } from "./carte.js";
import type { Garnison, JoueurId } from "./garnison.js";
import type { Grade } from "./grade.js";
import type { Severite } from "../combat/assaut.js";
import type { NomDoctrine } from "../horde/doctrines/index.js";

export interface InfoBlessure {
  readonly severite: Severite;
  /**
   * Heure absolue depuis t0 (début du J1 = heure 0) à laquelle le joueur
   * redevient apte au combat. Discrétisation en HEURES et non en jours :
   * le ceil() sur les jours faisait sortir toutes les blessures d'un
   * même jour ensemble et amplifiait les oscillations.
   *
   * Convention : l'assaut a lieu à 21h civile (RULES §2), donc une
   * blessure au jour J porte `heure_blessure = (J−1)×24 + 21`. Le retour
   * au combat vaut `heure_blessure + duree_inaptitude_heures`.
   *
   * Le joueur est APTE au combat pour l'assaut du jour K si
   * `retour_combat_heure ≤ (K−1)×24 + 21` (l'heure de l'assaut).
   */
  readonly retour_combat_heure: number;
  /**
   * Heure absolue depuis t0 à laquelle le joueur cesse d'être présent au
   * centre. Horloge INDÉPENDANTE de retour_combat_heure, plancher fixé
   * par `duree_presence_centre_min_heures` (RULES §9, deux horloges).
   *
   * Toujours ≥ retour_combat_heure. Entre les deux, le joueur est apte
   * au combat ET inscrit à la cour d'entraînement — deux appartenances
   * distinctes, pas exclusives.
   *
   * Le joueur EST au centre à la fin du jour K si
   * `fin_presence_centre_heure > K×24` (minuit de fin de K).
   */
  readonly fin_presence_centre_heure: number;
}

export interface EtatTransit {
  /** Lieu de destination (adjacent au lieu d'origine). */
  readonly destination_lieu_id: LieuId;
  /**
   * Jour civil d'arrivée au matin. Route = jour_départ + 1, sentier = +2.
   * La troupe ne défend rien tant que ce jour n'est pas atteint. À
   * l'arrivée, elle tombe en réserve du lieu de destination.
   */
  readonly arrivee_jour: number;
}

export interface EtatJoueur {
  readonly id: JoueurId;
  readonly grade: Grade;
  /**
   * Batailles restantes avant destruction de l'équipement.
   * Neuf = economie.usure_batailles_neuf ; 0 = équipement détruit.
   * Décroît de 1 à chaque assaut où le joueur combat effectivement.
   * Représentation directe de ce que le joueur voit — pas de traduction.
   */
  readonly usure_restante: number;
  /** Non null → convalescence au cœur, hors combat. */
  readonly blessure: InfoBlessure | null;
  /**
   * Non null → en marche vers un lieu adjacent. La troupe ne défend
   * NULLE PART pendant le transit (RULES §4). Aucun ordre accepté tant
   * qu'elle est en route. À l'arrivée, elle est posée en réserve du lieu
   * de destination.
   */
  readonly transit: EtatTransit | null;
}

export interface MetriquesDoctrine {
  /** Nombre de fois où la doctrine a obtenu son premier choix de préférence. */
  readonly premier_choix_obtenus: number;
  /** Nombre de fois où la doctrine a pioché dans le draft (jours ordinaires). */
  readonly draft_tours: number;
}

/** Cause par laquelle un lieu passe de royaume à horde/détruit. */
export type CauseChute = "assaut" | "famine" | "isole";

export interface EnregistrementChute {
  readonly lieu_id: import("./carte.js").LieuId;
  readonly jour: number;
  readonly cause: CauseChute;
}

export interface MetriquesCampagne {
  readonly premier_choix_par_doctrine: Readonly<Record<NomDoctrine, MetriquesDoctrine>>;
  readonly blessures_totales: {
    readonly legere: number;
    readonly serieuse: number;
    readonly grave: number;
  };
  readonly usure_consommee: number;
  readonly equipements_detruits: number;
  /**
   * Stock de joueurs présents au centre à la fin de chaque jour, APRÈS
   * les retours (sorties du centre appliquées). Un joueur en poste mais
   * encore inscrit à la cour compte comme présent — les deux horloges
   * sont indépendantes. Longueur croît d'un chaque jour simulé.
   */
  readonly blesses_au_centre_par_jour: readonly number[];
  /**
   * Couverture du pilier de transmission jour par jour :
   *   places_disponibles / recrues_présentes
   * où places_disponibles = stock_au_centre × places_eleves_par_blesse
   * et recrues_présentes = joueurs de grade "recrue" actifs (non blessés).
   * Valeur ≥ 1.0 = le pilier tient ; < 1.0 = plus de recrues que de places.
   */
  readonly couverture_par_jour: readonly number[];
  readonly lieux_royaume_par_jour: readonly number[];
  /** Volume total de la horde par jour ordinaire (0 les jours sans assaut). */
  readonly volume_par_jour: readonly number[];
  readonly nb_fronts_par_jour: readonly number[];
  /** Effectif défensif moyen sur les lieux attaqués ce jour (0 si aucun assaut). */
  readonly effectif_defensif_moyen_par_front_par_jour: readonly number[];
  /** Une entrée par lieu ayant chuté, dans l'ordre chronologique. */
  readonly chutes: readonly EnregistrementChute[];
  /** Nombre de lieux royaume au tout début de la campagne (avant J1). */
  readonly lieux_royaume_initial: number;
  /** Jour où la place forte tombe. Null si la province tient les 30 jours. */
  readonly jour_chute: number | null;
}

export interface EtatCampagne {
  readonly jour: number;
  readonly graine_lune: bigint;
  readonly province: Province;
  readonly garnisons: ReadonlyMap<LieuId, Garnison>;
  readonly vivres: ReadonlyMap<LieuId, number>;
  readonly joueurs: ReadonlyMap<JoueurId, EtatJoueur>;
  readonly puissance_varhal: number;
  readonly doctrines_actives: readonly NomDoctrine[];
  readonly metriques: MetriquesCampagne;
}

/**
 * Ordre atomique d'un joueur pour la prochaine journée.
 * - `affecter` : placer le joueur sur un abord donné avec une posture donnée.
 * - `reserve`  : joueur en réserve du lieu (non affecté à un abord).
 * - `deplacer` : quitter le lieu actuel vers un lieu adjacent tenu.
 *                Route = arrivée à J+1, sentier = arrivée à J+2. En transit
 *                la troupe ne défend nulle part (RULES §4).
 * - `aucun_ordre` : le joueur reste où il était (ou en réserve globale s'il est neuf).
 *
 * Un joueur INAPTE au combat voit ses ordres ignorés — il ne combat pas.
 * Un joueur EN TRANSIT voit ses ordres ignorés — il est occupé à marcher.
 */
export type OrdreJoueur =
  | {
      readonly type: "affecter";
      readonly lieu_id: LieuId;
      readonly abord_id: import("./carte.js").AbordId;
      readonly posture: import("./garnison.js").Posture;
    }
  | { readonly type: "reserve"; readonly lieu_id: LieuId }
  | { readonly type: "deplacer"; readonly vers_lieu_id: LieuId }
  | { readonly type: "aucun_ordre" };

/** Bilan d'un jour de simulation — ce que produit avancerJour à côté du nouvel état. */
export interface RapportJour {
  readonly jour: number;
  readonly est_offensive: boolean;
  readonly assauts: readonly {
    readonly lieu_id: LieuId;
    readonly doctrine: NomDoctrine;
    readonly issue: import("../combat/assaut.js").IssueAssaut;
    readonly rounds_utilises: number;
    readonly pertes_defenseur: number;
    readonly pertes_attaquant: number;
  }[];
  readonly lieux_perdus: readonly LieuId[];
  readonly blesses_du_jour: number;
  readonly usure_du_jour: number;
  readonly equipements_detruits_du_jour: number;
  readonly retours_de_blessure: number;
}
