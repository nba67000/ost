// Traduit une SortieAssaut en conséquences sur les joueurs :
// - blessures affectées aux joueurs (choisis en ordre lexicographique)
// - usure appliquée aux équipements des joueurs présents sur des abords
//   ayant combattu, +pénalité si l'abord a cédé
// - lieux perdus (tenu_par ← "horde")
//
// Blessures — RULES §10 nouvelle règle :
//   Toute perte du défenseur produit des blessés, avec deux régimes selon
//   que l'abord tient ou cède. La proba est PAR JOUEUR ENGAGÉ (pas une
//   fraction des effectifs perdus). Sur un paquet de P joueurs :
//     - abord tenu   : nb_blesses = round(P × part_tenu),  sévérité légère
//     - abord rompu  : nb_blesses = round(P × part_rompu), sévérité par ratio
//   Sélection déterministe : les nb_blesses premiers joueurs en ordre lex.

import type { Balance } from "../../config/schema.js";
import type { LieuId, Lieu } from "../types/carte.js";
import type { Garnison, JoueurId } from "../types/garnison.js";
import type { EtatJoueur, InfoBlessure } from "../types/campagne.js";
import type { SortieAssaut, Severite } from "../combat/assaut.js";

export interface DeltaConsequences {
  /** Blessures nouvelles créées ce jour. */
  readonly nouvelles_blessures: ReadonlyMap<JoueurId, InfoBlessure>;
  /** Nouvelle usure_restante des joueurs affectés (déjà clampée à ≥ 0). */
  readonly usures_mises_a_jour: ReadonlyMap<JoueurId, number>;
  /** Joueurs dont l'équipement est cassé ce jour (usure passée à 0). */
  readonly equipements_detruits_ids: readonly JoueurId[];
  /** Lieux dont l'issue est `lieu_tombe`. Tenu_par doit passer à "horde". */
  readonly lieux_perdus: readonly LieuId[];
  /** Effectifs à retirer de chaque paquet (par lieu et abord). */
  readonly pertes_par_abord: ReadonlyMap<
    LieuId,
    ReadonlyMap<import("../types/carte.js").AbordId, number>
  >;
}

export function calculerConsequences(
  lieu: Lieu,
  garnison: Garnison,
  sortie: SortieAssaut,
  joueurs: ReadonlyMap<JoueurId, EtatJoueur>,
  config: Balance,
): DeltaConsequences {
  const nouvellesBlessures = new Map<JoueurId, InfoBlessure>();
  const usuresMisesAJour = new Map<JoueurId, number>();
  const equipementsDetruitsIds: JoueurId[] = [];
  const lieuxPerdus: LieuId[] = [];
  const pertesParAbord = new Map<import("../types/carte.js").AbordId, number>();

  // 1. Blessures — RULES §10 : proba PAR JOUEUR ENGAGÉ.
  for (const d of sortie.details_blessures) {
    if (!d.a_subi_des_pertes) continue;
    const paquets = garnison.paquets.filter((p) => p.abord_id === d.abord_id);
    // Candidats = tous les joueurs présents dans les paquets de cet abord,
    // triés lex pour reproductibilité.
    const candidats = paquets.flatMap((p) => p.joueurs).sort();
    const P = candidats.length;
    if (P === 0) continue;
    const taux = d.rompu ? config.blessures.part_rompu : config.blessures.part_tenu;
    const nb = Math.round(P * taux);
    if (nb === 0) continue;
    const severite: Severite =
      d.rompu && d.severite_si_rompu !== null ? d.severite_si_rompu : "legere";
    for (let i = 0; i < nb && i < P; i++) {
      const jid = candidats[i]!;
      const j = joueurs.get(jid);
      if (j === undefined || j.blessure !== null) continue;
      nouvellesBlessures.set(jid, {
        severite,
        // Heures remplies à l'étage supérieur (avancerJour connaît le jour).
        retour_combat_heure: 0,
        fin_presence_centre_heure: 0,
      });
    }
  }

  // 2. Usure : pour chaque UsureAbord de la sortie, décrémenter les joueurs
  //    présents sur cet abord (paquets uniquement, pas la réserve).
  for (const u of sortie.usure) {
    if (u.cout <= 0) continue;
    const paquets = garnison.paquets.filter((p) => p.abord_id === u.abord_id);
    for (const p of paquets) {
      for (const jid of p.joueurs) {
        const j = joueurs.get(jid);
        if (j === undefined) continue;
        const dejaBaisse = usuresMisesAJour.get(jid) ?? j.usure_restante;
        const nouveau = Math.max(0, dejaBaisse - u.cout);
        usuresMisesAJour.set(jid, nouveau);
        if (dejaBaisse > 0 && nouveau === 0 && !equipementsDetruitsIds.includes(jid)) {
          equipementsDetruitsIds.push(jid);
        }
      }
    }
  }

  // 3. Pertes globales par abord (utile pour ajuster l'effectif des paquets).
  //    On somme depuis la SortieAssaut : parcourir tous les journaux de rounds
  //    et cumuler pertes_defenseur par abord.
  const pertesCumulees = new Map<import("../types/carte.js").AbordId, number>();
  for (const r of sortie.rounds) {
    for (const d of r.details_abords) {
      const dej = pertesCumulees.get(d.abord_id) ?? 0;
      pertesCumulees.set(d.abord_id, dej + d.pertes_defenseur);
    }
  }
  for (const [abord_id, n] of pertesCumulees) pertesParAbord.set(abord_id, n);

  // 4. Chute du lieu ?
  if (sortie.issue === "lieu_tombe") lieuxPerdus.push(lieu.id);

  return {
    nouvelles_blessures: nouvellesBlessures,
    usures_mises_a_jour: usuresMisesAJour,
    equipements_detruits_ids: equipementsDetruitsIds,
    lieux_perdus: lieuxPerdus,
    pertes_par_abord: new Map([[lieu.id, pertesParAbord]]),
  };
}
