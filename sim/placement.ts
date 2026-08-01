// Placement initial : distribution déterministe des joueurs sur la carte
// au jour 1, selon leur grade.
//
// Règle simple :
//   - Général(aux) : à la place forte, sur l'abord le plus fortifié.
//   - Capitaine(s) : place forte, abords suivants.
//   - Sergent(s) : feux de guet, un par lieu si possible, sinon overflow PF.
//   - Caporaux : postes avancés, sinon feux de guet.
//   - Soldats + recrues : réserve de la place forte.
//
// Tri déterministe des cibles : par nature du lieu puis LieuId lex.

import type { Balance } from "../config/schema.js";
import type { AbordId, LieuId, Province } from "../engine/types/carte.js";
import type { Garnison, JoueurId, PaquetGarnison } from "../engine/types/garnison.js";
import type { EtatJoueur } from "../engine/types/campagne.js";
import { effectifJoueur } from "../engine/jour/adapter.js";
import { PONDERATION_GRADES } from "../engine/jour/ponderation.js";
import { lieuxExposes } from "../engine/horde/exposes.js";
import { detecterGoulots } from "../engine/carte/goulots.js";

export function placementInitial(
  province: Province,
  joueurs: ReadonlyMap<JoueurId, EtatJoueur>,
  config: Balance,
): Map<LieuId, Garnison> {
  const garnisons = new Map<LieuId, Garnison>();
  for (const l of province.lieux) {
    garnisons.set(l.id, { lieu_id: l.id, paquets: [], reserve: [] });
  }

  const pf = province.lieux.find((l) => l.id === province.place_forte_id);
  const feux = province.lieux
    .filter((l) => l.nature === "feu_de_guet" && l.tenu_par === "royaume")
    .sort((a, b) => (a.id as string).localeCompare(b.id as string, "en"));
  const postes = province.lieux
    .filter((l) => l.nature === "poste_avance" && l.tenu_par === "royaume")
    .sort((a, b) => (a.id as string).localeCompare(b.id as string, "en"));

  // Groupes de joueurs par grade, triés lex.
  const groupes = {
    general: [] as EtatJoueur[],
    capitaine: [] as EtatJoueur[],
    sergent: [] as EtatJoueur[],
    caporal: [] as EtatJoueur[],
    soldat: [] as EtatJoueur[],
    recrue: [] as EtatJoueur[],
  };
  for (const j of joueurs.values()) groupes[j.grade].push(j);
  for (const key of Object.keys(groupes) as Array<keyof typeof groupes>) {
    groupes[key].sort((a, b) => (a.id as string).localeCompare(b.id as string, "en"));
  }

  // Helpers d'affectation.
  function ajouterAuPaquet(
    lieu_id: LieuId,
    abord_id: import("../engine/types/carte.js").AbordId,
    j: EtatJoueur,
  ) {
    const g = garnisons.get(lieu_id)!;
    let pq = g.paquets.find((p) => p.abord_id === abord_id && p.posture === "mur");
    if (pq === undefined) {
      pq = { abord_id, joueurs: [], effectif: 0, posture: "mur" };
      (g.paquets as PaquetGarnison[]).push(pq);
    }
    (pq.joueurs as JoueurId[]).push(j.id);
    (pq as { effectif: number }).effectif += effectifJoueur(j, config);
  }
  function ajouterEnReserve(lieu_id: LieuId, j: EtatJoueur) {
    const g = garnisons.get(lieu_id)!;
    (g.reserve as JoueurId[]).push(j.id);
  }

  // Générauxx + capitaines sur les abords de la PF, par ordre de fortification décroissante.
  if (pf !== undefined) {
    const abordsPF = [...pf.abords].sort(
      (a, b) =>
        b.fortification - a.fortification || (a.id as string).localeCompare(b.id as string, "en"),
    );
    let i = 0;
    for (const j of groupes.general) {
      ajouterAuPaquet(pf.id, abordsPF[i % abordsPF.length]!.id, j);
      i++;
    }
    for (const j of groupes.capitaine) {
      ajouterAuPaquet(pf.id, abordsPF[i % abordsPF.length]!.id, j);
      i++;
    }
  }

  // Sergents : un par feu_de_guet si possible, sinon overflow réserve PF.
  let idxSergent = 0;
  for (const j of groupes.sergent) {
    if (idxSergent < feux.length) {
      const l = feux[idxSergent]!;
      ajouterAuPaquet(l.id, l.abords[0]!.id, j);
      idxSergent++;
    } else if (pf !== undefined) {
      ajouterEnReserve(pf.id, j);
    }
  }

  // Caporaux : postes avancés puis feux (secondaire) puis réserve.
  let idxCaporal = 0;
  for (const j of groupes.caporal) {
    if (idxCaporal < postes.length) {
      const l = postes[idxCaporal]!;
      ajouterAuPaquet(l.id, l.abords[0]!.id, j);
      idxCaporal++;
    } else if (pf !== undefined) {
      ajouterEnReserve(pf.id, j);
    }
  }

  // Soldats + recrues : tout en réserve à la PF.
  if (pf !== undefined) {
    for (const j of groupes.soldat) ajouterEnReserve(pf.id, j);
    for (const j of groupes.recrue) ajouterEnReserve(pf.id, j);
  }

  return garnisons;
}

/**
 * Placement initial ALTERNATIF : les joueurs sont déployés directement sur
 * les abords des lieux EXPOSÉS au J0, greedy par grade décroissant sur le
 * plus grand déficit relatif à l'objectif (pondération goulot = part_goulot).
 *
 * C'est le placement que le concentrateur produit implicitement au J1 par
 * son affecter direct. Sert à comparer équitablement réactif/prévoyant qui,
 * eux, sont contraints par le délai de déplacement (1 jour de retard sur
 * n'importe quel redéploiement).
 */
export function placementInitialSurExposes(
  province: Province,
  joueurs: ReadonlyMap<JoueurId, EtatJoueur>,
  config: Balance,
): Map<LieuId, Garnison> {
  const garnisons = new Map<LieuId, Garnison>();
  for (const l of province.lieux) {
    garnisons.set(l.id, { lieu_id: l.id, paquets: [], reserve: [] });
  }
  const exposes = lieuxExposes(province.lieux, province.liens, province.entrees);
  if (exposes.length === 0) return garnisons;

  const lieuParId = new Map(province.lieux.map((l) => [l.id, l]));
  const royaumeIds = new Set(
    province.lieux.filter((l) => l.tenu_par === "royaume").map((l) => l.id),
  );
  const goulots = new Set(
    detecterGoulots(royaumeIds, province.liens, province.place_forte_id),
  );
  const partGoulot = config.horde.part_goulot;

  const poidsParLieu = new Map<LieuId, number>();
  for (const lid of exposes) poidsParLieu.set(lid, goulots.has(lid) ? partGoulot : 1);
  const sommePoids = [...poidsParLieu.values()].reduce((a, b) => a + b, 0);

  const dispos = [...joueurs.values()].sort((a, b) => {
    const dg = PONDERATION_GRADES.indexOf(b.grade) - PONDERATION_GRADES.indexOf(a.grade);
    if (dg !== 0) return dg;
    return (a.id as string).localeCompare(b.id as string, "en");
  });
  const effTotal = dispos.reduce((s, j) => s + config.grades.effectif_commande[j.grade], 0);

  interface CibleAbord {
    readonly lieu_id: LieuId;
    readonly abord_id: AbordId;
    readonly cible: number;
    courant: number;
  }
  const cibles: CibleAbord[] = [];
  for (const lid of exposes) {
    const lieu = lieuParId.get(lid);
    if (lieu === undefined || lieu.abords.length === 0) continue;
    const effLieu = effTotal * (poidsParLieu.get(lid)! / sommePoids);
    const parAbord = effLieu / lieu.abords.length;
    for (const a of lieu.abords) {
      cibles.push({ lieu_id: lid, abord_id: a.id, cible: parAbord, courant: 0 });
    }
  }
  if (cibles.length === 0) return garnisons;

  for (const j of dispos) {
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
    if (meilleur === null) break;
    const g = garnisons.get(meilleur.lieu_id)!;
    let pq = g.paquets.find((p) => p.abord_id === meilleur!.abord_id && p.posture === "mur");
    if (pq === undefined) {
      pq = { abord_id: meilleur.abord_id, joueurs: [], effectif: 0, posture: "mur" };
      (g.paquets as PaquetGarnison[]).push(pq);
    }
    (pq.joueurs as JoueurId[]).push(j.id);
    (pq as { effectif: number }).effectif += effectifJoueur(j, config);
    meilleur.courant += config.grades.effectif_commande[j.grade];
  }

  return garnisons;
}
