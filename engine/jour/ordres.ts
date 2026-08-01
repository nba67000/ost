// Application des ordres du jour : construit un nouvel état de garnisons à
// partir de l'état courant + un OrdreJoueur par joueur.
//
// Règles :
// - Un joueur BLESSÉ voit ses ordres ignorés (il ne combat pas).
// - `affecter` : le joueur quitte sa position précédente, rejoint le paquet
//   (lieu_id, abord_id, posture) demandé.
// - `reserve`  : le joueur quitte sa position, rejoint la réserve du lieu.
// - `aucun_ordre` : le joueur ne bouge pas — position figée.
//
// Deux joueurs affectés au même (abord, posture) partagent un seul paquet.
// Deux postures différentes sur le même abord = deux paquets distincts.

import type { Balance } from "../../config/schema.js";
import type { LieuId } from "../types/carte.js";
import type { Garnison, JoueurId, PaquetGarnison } from "../types/garnison.js";
import type { EtatJoueur, OrdreJoueur } from "../types/campagne.js";
import { effectifJoueur } from "./adapter.js";

/**
 * Construit les garnisons du jour à partir des ordres.
 * Retourne une Map immutable prête à être posée sur l'EtatCampagne.
 *
 * Un joueur est INAPTE au combat si `blessure !== null && retour_combat_jour
 * > jour_courant`. Ses ordres sont ignorés. Un joueur blessé mais dont
 * l'inaptitude a expiré (encore présent au centre pour la convalescence)
 * peut reprendre son poste normalement — les deux horloges sont
 * indépendantes (RULES §9).
 */
export function appliquerOrdres(
  garnisonsPrecedentes: ReadonlyMap<LieuId, Garnison>,
  ordres: ReadonlyMap<JoueurId, OrdreJoueur>,
  joueurs: ReadonlyMap<JoueurId, EtatJoueur>,
  province_lieux: readonly LieuId[],
  config: Balance,
  jour_courant: number,
): Map<LieuId, Garnison> {
  // Étape 1 : joueurId → position (lieu, abord, posture) ou reserve, dérivé
  // de la garnison précédente.
  type Position =
    | {
        readonly type: "abord";
        readonly lieu_id: LieuId;
        readonly abord_id: import("../types/carte.js").AbordId;
        readonly posture: import("../types/garnison.js").Posture;
      }
    | { readonly type: "reserve"; readonly lieu_id: LieuId }
    | { readonly type: "hors" }; // pas encore placé (nouveau joueur, ou tout début)

  const positionCourante = new Map<JoueurId, Position>();
  for (const [lid, g] of garnisonsPrecedentes) {
    for (const p of g.paquets) {
      for (const jid of p.joueurs) {
        positionCourante.set(jid, {
          type: "abord",
          lieu_id: lid,
          abord_id: p.abord_id,
          posture: p.posture,
        });
      }
    }
    for (const jid of g.reserve) {
      positionCourante.set(jid, { type: "reserve", lieu_id: lid });
    }
  }
  for (const jid of joueurs.keys()) {
    if (!positionCourante.has(jid)) positionCourante.set(jid, { type: "hors" });
  }

  // Étape 2 : appliquer chaque ordre. Ignore les inaptes au combat ;
  // accepte les blessés dont retour_combat_jour ≤ jour_courant même s'ils
  // sont encore présents au centre pour la convalescence.
  for (const [jid, ordre] of ordres) {
    const j = joueurs.get(jid);
    if (j === undefined) continue;
    if (j.blessure !== null && j.blessure.retour_combat_jour > jour_courant) continue;
    if (ordre.type === "aucun_ordre") continue;
    if (ordre.type === "affecter") {
      positionCourante.set(jid, {
        type: "abord",
        lieu_id: ordre.lieu_id,
        abord_id: ordre.abord_id,
        posture: ordre.posture,
      });
    } else {
      positionCourante.set(jid, { type: "reserve", lieu_id: ordre.lieu_id });
    }
  }

  // Étape 3 : reconstruire les Garnison à partir de positionCourante.
  const nouvellesGarnisons = new Map<LieuId, Garnison>();
  for (const lid of province_lieux) {
    nouvellesGarnisons.set(lid, { lieu_id: lid, paquets: [], reserve: [] });
  }
  // Buckets intermédiaires : lieu → (abord, posture) → JoueurId[]
  const buckets = new Map<
    LieuId,
    Map<
      string,
      {
        abord_id: import("../types/carte.js").AbordId;
        posture: import("../types/garnison.js").Posture;
        joueurs: JoueurId[];
      }
    >
  >();
  const reserves = new Map<LieuId, JoueurId[]>();

  for (const [jid, pos] of positionCourante) {
    if (pos.type === "hors") continue;
    if (pos.type === "reserve") {
      const r = reserves.get(pos.lieu_id) ?? [];
      r.push(jid);
      reserves.set(pos.lieu_id, r);
      continue;
    }
    // type === "abord"
    const key = `${pos.abord_id}::${pos.posture}`;
    let m = buckets.get(pos.lieu_id);
    if (m === undefined) {
      m = new Map();
      buckets.set(pos.lieu_id, m);
    }
    let b = m.get(key);
    if (b === undefined) {
      b = { abord_id: pos.abord_id, posture: pos.posture, joueurs: [] };
      m.set(key, b);
    }
    b.joueurs.push(jid);
  }

  // Étape 4 : matérialiser en Garnison.
  for (const lid of province_lieux) {
    const paquets: PaquetGarnison[] = [];
    const m = buckets.get(lid);
    if (m !== undefined) {
      // Ordre stable : par abord_id puis posture.
      const keys = [...m.keys()].sort();
      for (const k of keys) {
        const b = m.get(k)!;
        // Tri lex des joueurs pour reproductibilité.
        b.joueurs.sort();
        let eff = 0;
        for (const jid of b.joueurs) {
          const j = joueurs.get(jid);
          if (j !== undefined) eff += effectifJoueur(j, config);
        }
        paquets.push({
          abord_id: b.abord_id,
          joueurs: b.joueurs,
          effectif: eff,
          posture: b.posture,
        });
      }
    }
    const res = (reserves.get(lid) ?? []).sort();
    nouvellesGarnisons.set(lid, { lieu_id: lid, paquets, reserve: res });
  }

  return nouvellesGarnisons;
}
