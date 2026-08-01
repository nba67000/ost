// Traduit une SortieAssaut en conséquences sur les joueurs :
// - blessures affectées aux joueurs (choisis en ordre lexicographique)
// - usure appliquée aux équipements des joueurs présents sur des abords
//   ayant combattu, +pénalité si l'abord a cédé
// - lieux perdus (tenu_par ← "horde")
//
// Fonction pure : reçoit l'état, retourne un delta explicite.

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
  _config: Balance,
): DeltaConsequences {
  const nouvellesBlessures = new Map<JoueurId, InfoBlessure>();
  const usuresMisesAJour = new Map<JoueurId, number>();
  const equipementsDetruitsIds: JoueurId[] = [];
  const lieuxPerdus: LieuId[] = [];
  const pertesParAbord = new Map<import("../types/carte.js").AbordId, number>();

  // 1. Blessures : les Blessure de SortieAssaut portent { abord_id, severite }.
  //    Une blessure = un joueur retiré du paquet. On pioche en ordre lex sur
  //    les joueurs du paquet correspondant.
  const compteBlessures = new Map<import("../types/carte.js").AbordId, Severite[]>();
  for (const b of sortie.blessures) {
    const arr = compteBlessures.get(b.abord_id) ?? [];
    arr.push(b.severite);
    compteBlessures.set(b.abord_id, arr);
  }
  for (const [abord_id, severites] of compteBlessures) {
    const paquets = garnison.paquets.filter((p) => p.abord_id === abord_id);
    // Fusion des joueurs de tous les paquets de cet abord, triés lex.
    const candidats = paquets.flatMap((p) => p.joueurs).sort();
    for (let i = 0; i < severites.length && i < candidats.length; i++) {
      const jid = candidats[i]!;
      const j = joueurs.get(jid);
      if (j === undefined || j.blessure !== null) continue;
      nouvellesBlessures.set(jid, {
        severite: severites[i]!,
        retour_jour: 0, // rempli à l'étage supérieur (avancerJour connaît le jour)
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
