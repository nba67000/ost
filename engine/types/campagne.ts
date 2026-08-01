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
  /** Jour civil où le joueur redevient disponible (au matin, avant l'assaut). */
  readonly retour_jour: number;
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
}

export interface MetriquesDoctrine {
  /** Nombre de fois où la doctrine a obtenu son premier choix de préférence. */
  readonly premier_choix_obtenus: number;
  /** Nombre de fois où la doctrine a pioché dans le draft (jours ordinaires). */
  readonly draft_tours: number;
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
   * Effectif de joueurs blessés au centre à la fin de chaque jour, APRÈS
   * les retours. Longueur croît d'un chaque jour simulé.
   */
  readonly blesses_au_centre_par_jour: readonly number[];
  readonly lieux_royaume_par_jour: readonly number[];
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
 * - `aucun_ordre` : le joueur reste où il était (ou en réserve globale s'il est neuf).
 *
 * Un joueur BLESSÉ voit ses ordres ignorés — il ne combat pas.
 */
export type OrdreJoueur =
  | {
      readonly type: "affecter";
      readonly lieu_id: LieuId;
      readonly abord_id: import("./carte.js").AbordId;
      readonly posture: import("./garnison.js").Posture;
    }
  | { readonly type: "reserve"; readonly lieu_id: LieuId }
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
