// Meute — 60 % chien_de_fosse, 40 % souche.
//
// SEULE doctrine qui observe la disposition défensive du jour. Vise le lieu
// exposé le plus faiblement garni, sur l'abord le moins garni de ce lieu.
//
// Ce n'est PAS une adaptation au succès (interdite par RULES §7-4) — c'est
// une réaction à la disposition instantanée. La différence tient : elle ne
// consulte jamais l'historique des assauts, seulement l'état du jour.
//
// Signature diégétique : les chiens sont des pisteurs. Ils flairent le
// creux dans la ligne. Punit tout point négligé au matin même.

import type { AbordId, Lieu } from "../../types/carte.js";
import type { Vague } from "../../types/forge.js";
import type { Composition, Doctrine } from "./types.js";
import {
  composerVague,
  effectifAbord,
  effectifGarnison,
  indexerLieux,
  trierCroissant,
} from "./composer.js";

const COMPOSITION: Composition = {
  souche: 0.4,
  ecorcheur: 0,
  belier: 0,
  chien_de_fosse: 0.6,
  muet: 0,
};

export const meute: Doctrine = {
  nom: "meute",
  composition: COMPOSITION,

  preferer(exposes, ctx) {
    return trierCroissant(exposes, (id) => effectifGarnison(ctx.garnisons.get(id)));
  },

  choisirAbord(lieu: Lieu, ctx): AbordId {
    const g = ctx.garnisons.get(lieu.id);
    let meilleur = lieu.abords[0]!;
    let meilleurE = effectifAbord(g, meilleur.id);
    for (let i = 1; i < lieu.abords.length; i++) {
      const a = lieu.abords[i]!;
      const e = effectifAbord(g, a.id);
      if (e < meilleurE || (e === meilleurE && (a.id as string) < (meilleur.id as string))) {
        meilleur = a;
        meilleurE = e;
      }
    }
    return meilleur.id;
  },

  planifier(fronts, ctx): readonly Vague[] {
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
