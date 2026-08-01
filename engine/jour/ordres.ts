// Application des ordres du jour : construit un nouvel état de garnisons à
// partir de l'état courant + un OrdreJoueur par joueur.
//
// Règles :
// - Un joueur INAPTE au combat (blessure.retour_combat > jour) voit ses
//   ordres ignorés.
// - Un joueur EN TRANSIT (arrivee_jour > jour) voit ses ordres ignorés — il
//   est occupé à marcher (RULES §4).
// - `affecter`  : le joueur va au paquet (lieu, abord, posture) demandé.
//   Nécessite d'être déjà présent à ce lieu (transit interdit à distance).
// - `reserve`   : joueur en réserve du lieu où il est déjà.
// - `deplacer`  : quitte son lieu actuel, entre en transit vers un voisin
//   tenu. Route = arrivée à J+1, sentier = arrivée à J+2. En transit, il
//   ne défend nulle part.
// - `aucun_ordre` : le joueur ne bouge pas — position figée.

import type { Balance } from "../../config/schema.js";
import type { LieuId, Province } from "../types/carte.js";
import type { Garnison, JoueurId, PaquetGarnison } from "../types/garnison.js";
import type { EtatJoueur, EtatTransit, OrdreJoueur } from "../types/campagne.js";
import { effectifJoueur } from "./adapter.js";

export interface SortieOrdres {
  readonly garnisons: Map<LieuId, Garnison>;
  /** Nouveaux transits produits ce jour (joueurs qui viennent de partir). */
  readonly nouveaux_transits: Map<JoueurId, EtatTransit>;
}

export function appliquerOrdres(
  garnisonsPrecedentes: ReadonlyMap<LieuId, Garnison>,
  ordres: ReadonlyMap<JoueurId, OrdreJoueur>,
  joueurs: ReadonlyMap<JoueurId, EtatJoueur>,
  province: Province,
  config: Balance,
  jour_courant: number,
): SortieOrdres {
  // Étape 1 : position courante dérivée de la garnison précédente.
  type Position =
    | {
        readonly type: "abord";
        readonly lieu_id: LieuId;
        readonly abord_id: import("../types/carte.js").AbordId;
        readonly posture: import("../types/garnison.js").Posture;
      }
    | { readonly type: "reserve"; readonly lieu_id: LieuId }
    | { readonly type: "hors" };

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

  const nouveauxTransits = new Map<JoueurId, EtatTransit>();
  const enTransit = new Set<JoueurId>();
  for (const [jid, j] of joueurs) {
    if (j.transit !== null && j.transit.arrivee_jour > jour_courant) enTransit.add(jid);
  }

  // Étape 2 : appliquer chaque ordre.
  for (const [jid, ordre] of ordres) {
    const j = joueurs.get(jid);
    if (j === undefined) continue;
    if (j.blessure !== null && j.blessure.retour_combat_jour > jour_courant) continue;
    if (enTransit.has(jid)) continue;
    if (ordre.type === "aucun_ordre") continue;
    if (ordre.type === "affecter") {
      positionCourante.set(jid, {
        type: "abord",
        lieu_id: ordre.lieu_id,
        abord_id: ordre.abord_id,
        posture: ordre.posture,
      });
      continue;
    }
    if (ordre.type === "reserve") {
      positionCourante.set(jid, { type: "reserve", lieu_id: ordre.lieu_id });
      continue;
    }
    // ordre.type === "deplacer"
    const posOrig = positionCourante.get(jid);
    if (posOrig === undefined || posOrig.type === "hors") continue;
    const duree = dureeTransit(province, posOrig.lieu_id, ordre.vers_lieu_id);
    if (duree === null) continue; // pas adjacent ou pas royaume — ordre invalide
    nouveauxTransits.set(jid, {
      destination_lieu_id: ordre.vers_lieu_id,
      arrivee_jour: jour_courant + duree,
    });
    positionCourante.set(jid, { type: "hors" });
  }

  // Étape 3 : les en-transit non concernés par un nouvel ordre restent hors.
  for (const jid of enTransit) positionCourante.set(jid, { type: "hors" });

  // Étape 4 : reconstruire les Garnison.
  const nouvellesGarnisons = new Map<LieuId, Garnison>();
  for (const l of province.lieux) {
    nouvellesGarnisons.set(l.id, { lieu_id: l.id, paquets: [], reserve: [] });
  }
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

  for (const l of province.lieux) {
    const paquets: PaquetGarnison[] = [];
    const m = buckets.get(l.id);
    if (m !== undefined) {
      const keys = [...m.keys()].sort();
      for (const k of keys) {
        const b = m.get(k)!;
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
    const res = (reserves.get(l.id) ?? []).sort();
    nouvellesGarnisons.set(l.id, { lieu_id: l.id, paquets, reserve: res });
  }

  return { garnisons: nouvellesGarnisons, nouveaux_transits: nouveauxTransits };
}

/**
 * Durée de transit entre deux lieux adjacents tenus par le royaume.
 * Route = 1 jour, sentier = 2 jours. Null si l'ordre est invalide (lieux
 * non adjacents, destination non royaume, ou l'un des deux est absent).
 */
function dureeTransit(province: Province, from: LieuId, to: LieuId): number | null {
  if (from === to) return null;
  const parId = new Map(province.lieux.map((l) => [l.id, l]));
  const lieuTo = parId.get(to);
  if (lieuTo === undefined || lieuTo.tenu_par !== "royaume") return null;
  for (const lien of province.liens) {
    if ((lien.a === from && lien.b === to) || (lien.b === from && lien.a === to)) {
      return lien.nature === "route" ? 1 : 2;
    }
  }
  return null;
}
