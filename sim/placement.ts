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
import type { LieuId, Province } from "../engine/types/carte.js";
import type { Garnison, JoueurId, PaquetGarnison } from "../engine/types/garnison.js";
import type { EtatJoueur } from "../engine/types/campagne.js";
import { effectifJoueur } from "../engine/jour/adapter.js";

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
