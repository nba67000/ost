// Marteau — 70 % bélier, 30 % souche.
// Frappe le point le plus dur : lieu exposé le plus fortifié, abord le plus
// fortifié à l'intérieur de ce lieu.
//
// Signature diégétique : brise-mur, cognée sourde. Reconnaissable en 2-3
// assauts — il ne va nulle part ailleurs.

import type { AbordId, Lieu } from "../../types/carte.js";
import type { Vague } from "../../types/forge.js";
import type { Composition, Doctrine } from "./types.js";
import { composerVague, fortificationTotale, indexerLieux, trierDecroissant } from "./composer.js";

const COMPOSITION: Composition = {
  souche: 0.3,
  ecorcheur: 0,
  belier: 0.7,
  chien_de_fosse: 0,
  muet: 0,
};

export const marteau: Doctrine = {
  nom: "marteau",
  composition: COMPOSITION,

  preferer(exposes, ctx) {
    const parId = indexerLieux(ctx.province);
    return trierDecroissant(exposes, (id) => fortificationTotale(parId.get(id)!));
  },

  choisirAbord(lieu: Lieu): AbordId {
    let meilleur = lieu.abords[0]!;
    for (const a of lieu.abords) {
      if (
        a.fortification > meilleur.fortification ||
        (a.fortification === meilleur.fortification && (a.id as string) < (meilleur.id as string))
      ) {
        meilleur = a;
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
