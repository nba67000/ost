// Écorcheurs — 100 % écorcheur.
// La lame qui trouve le pli. Vise le lieu exposé le moins fortifié, abord le
// moins fortifié. Punit ce que le joueur a négligé structurellement.
//
// N'observe pas la garnison — seulement la fortification bâtie.

import type { AbordId, Lieu } from "../../types/carte.js";
import type { Vague } from "../../types/forge.js";
import type { Composition, Doctrine } from "./types.js";
import { composerVague, fortificationTotale, indexerLieux, trierCroissant } from "./composer.js";

const COMPOSITION: Composition = {
  souche: 0,
  ecorcheur: 1,
  belier: 0,
  chien_de_fosse: 0,
  muet: 0,
};

export const ecorcheurs: Doctrine = {
  nom: "ecorcheurs",
  composition: COMPOSITION,

  preferer(exposes, ctx) {
    const parId = indexerLieux(ctx.province);
    return trierCroissant(exposes, (id) => fortificationTotale(parId.get(id)!));
  },

  choisirAbord(lieu: Lieu): AbordId {
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
