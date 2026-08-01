// Serpent — 100 % muet.
// Vise la place forte si elle est exposée, sinon le lieu exposé le plus
// fortifié. Sur ce lieu, choisit l'abord selon une PERMUTATION DÉRIVÉE DE
// LA GRAINE DE LUNE : abord = permutation[(jour - 1) % nb_abords].
//
// Une permutation par lune, par lieu. Publiée après quelques assauts, elle
// meurt à la fin de la lune — la suivante en génère une nouvelle. C'est le
// savoir qu'un vétéran conserve : la lecture d'un chiffrement quotidien.

import type { AbordId, Lieu, LieuId } from "../../types/carte.js";
import type { Vague } from "../../types/forge.js";
import type { Composition, CtxCiblage, Doctrine } from "./types.js";
import { composerVague, fortificationTotale, indexerLieux, trierDecroissant } from "./composer.js";
import { creerRng } from "../../rng/index.js";

const COMPOSITION: Composition = {
  souche: 0,
  ecorcheur: 0,
  belier: 0,
  chien_de_fosse: 0,
  muet: 1,
};

/**
 * Permutation stable d'un tableau d'AbordId dérivée de la graine de lune et
 * de l'identifiant du lieu. Deux appels avec les mêmes entrées produisent
 * la même permutation.
 *
 * Algorithme de Fisher-Yates classique alimenté par le PRNG.
 */
function permuter(abords: readonly AbordId[], graine_lune: bigint, lieu_id: LieuId): AbordId[] {
  const rng = creerRng(graine_lune).deriver(`serpent:${lieu_id}`);
  const tri = [...abords].sort((a, b) => (a as string).localeCompare(b as string, "en"));
  for (let i = tri.length - 1; i > 0; i--) {
    const j = rng.entier(0, i);
    const tmp = tri[i]!;
    tri[i] = tri[j]!;
    tri[j] = tmp;
  }
  return tri;
}

export const serpent: Doctrine = {
  nom: "serpent",
  composition: COMPOSITION,

  preferer(exposes, ctx) {
    const pf = ctx.province.place_forte_id;
    if (exposes.includes(pf)) {
      const autres = exposes.filter((id) => id !== pf);
      const parId = indexerLieux(ctx.province);
      return [pf, ...trierDecroissant(autres, (id) => fortificationTotale(parId.get(id)!))];
    }
    const parId = indexerLieux(ctx.province);
    return trierDecroissant(exposes, (id) => fortificationTotale(parId.get(id)!));
  },

  choisirAbord(lieu: Lieu, ctx: CtxCiblage): AbordId {
    const abords = lieu.abords.map((a) => a.id);
    const perm = permuter(abords, ctx.graine_lune, lieu.id);
    return perm[(ctx.jour - 1 + perm.length * 1000) % perm.length]!;
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
