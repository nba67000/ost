// Garde — 50 % muet, 50 % souche.
// Frappe la porte : entree_principale tant qu'elle est tenue par le royaume
// et exposée. Sinon, le lieu exposé le plus PROCHE de l'entrée principale
// (BFS sur routes + sentiers).
//
// L'entrée principale est la porte d'entrée du royaume — l'accès par où la
// pression majeure de Varhal arrive. Elle est le PREMIER pas de l'ennemi
// dans la province, pas le cœur.

import type { AbordId, Lieu, LieuId } from "../../types/carte.js";
import type { Vague } from "../../types/forge.js";
import type { Composition, CtxCiblage, Doctrine } from "./types.js";
import { composerVague, distancesDepuis, indexerLieux, trierCroissant } from "./composer.js";

const COMPOSITION: Composition = {
  souche: 0.5,
  ecorcheur: 0,
  belier: 0,
  chien_de_fosse: 0,
  muet: 0.5,
};

export const garde: Doctrine = {
  nom: "garde",
  composition: COMPOSITION,

  preferer(exposes, ctx) {
    const entreePrincipale = ctx.province.entree_principale;
    // Cas 1 : l'entrée principale est dans les exposés → priorité absolue.
    if (exposes.includes(entreePrincipale)) {
      // Elle passe en tête, le reste conserve son ordre lexicographique.
      const autres = exposes.filter((id) => id !== entreePrincipale);
      return [entreePrincipale, ...trierCroissant(autres, () => 0)];
    }
    // Cas 2 : sinon, tri par distance croissante à l'entrée principale.
    const dist = distancesDepuis(entreePrincipale, ctx);
    const INF = Number.MAX_SAFE_INTEGER;
    return trierCroissant(exposes, (id) => dist.get(id) ?? INF);
  },

  choisirAbord(lieu: Lieu): AbordId {
    // Abord le moins fortifié — Garde n'a pas de règle spécifique sur l'abord
    // dans le tableau des doctrines. On prend le maillon faible par défaut.
    let meilleur = lieu.abords[0]!;
    for (const a of lieu.abords) {
      if (
        a.fortification < meilleur.fortification ||
        (a.fortification === meilleur.fortification && (a.id as string) < (meilleur.id as string))
      ) {
        meilleur = a;
      }
    }
    return meilleur.id;
  },

  planifier(fronts: readonly LieuId[], ctx: CtxCiblage): readonly Vague[] {
    const parId = indexerLieux(ctx.province);
    const vagues: Vague[] = [];
    for (let i = 0; i < fronts.length; i++) {
      const lid = fronts[i]!;
      const lieu = parId.get(lid)!;
      const abord = this.choisirAbord(lieu, ctx);
      vagues.push(composerVague(lid, abord, ctx.volumes_par_front[i]!, COMPOSITION));
    }
    return vagues;
  },
};
