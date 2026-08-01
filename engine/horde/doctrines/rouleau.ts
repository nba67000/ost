// Rouleau — 100 % souche.
// Pression égale partout, aucune préférence. Le degré zéro de la doctrine :
// c'est ce qui reste quand aucune spécialité ne s'exprime.
//
// Reconnaissable par l'ABSENCE de signature : pas de mono-lieu, pas de
// spécialité, pas de rotation. La composition est aussi neutre — la souche
// n'a pas de faiblesse marquée dans la matrice de posture.

import type { AbordId, Lieu } from "../../types/carte.js";
import type { Vague } from "../../types/forge.js";
import type { Composition, Doctrine } from "./types.js";
import { composerVague, indexerLieux, triLexicographique } from "./composer.js";

const COMPOSITION: Composition = {
  souche: 1,
  ecorcheur: 0,
  belier: 0,
  chien_de_fosse: 0,
  muet: 0,
};

export const rouleau: Doctrine = {
  nom: "rouleau",
  composition: COMPOSITION,

  preferer(exposes) {
    return triLexicographique(exposes);
  },

  choisirAbord(lieu: Lieu): AbordId {
    let meilleur = lieu.abords[0]!;
    for (const a of lieu.abords) {
      if ((a.id as string) < (meilleur.id as string)) meilleur = a;
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
