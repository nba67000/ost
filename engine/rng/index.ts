// PRNG déterministe pour /engine.
// Aucune I/O, aucun Date.now, aucun Math.random. Reproductible à graine égale.
// Algo : SplitMix64. Dérivation par contexte via XOR sur un hash stable (FNV-1a 64).

export type Graine = bigint;

const MASK_64 = 0xffffffffffffffffn;
const GAMMA = 0x9e3779b97f4a7c15n;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

function hashContexte(contexte: string): bigint {
  let hash = FNV_OFFSET;
  for (let i = 0; i < contexte.length; i++) {
    hash ^= BigInt(contexte.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash;
}

export interface RNG {
  /** Un entier 64 bits non signé, sous forme de bigint. */
  suivant(): bigint;
  /** Un flottant dans [0, 1). */
  flottant(): number;
  /** Un entier dans [min, max] inclus, sans biais de modulo. */
  entier(min: number, max: number): number;
  /**
   * Dérive un nouveau RNG à partir d'un contexte textuel. Le flux résultant est
   * indépendant de l'état courant du parent : `parent.deriver("combat")` renvoie
   * toujours le même flux tant que la graine initiale du parent est identique.
   */
  deriver(contexte: string): RNG;
}

export function creerRng(graine: Graine): RNG {
  const grainePropre = graine & MASK_64;
  let etat = grainePropre;

  function suivant(): bigint {
    etat = (etat + GAMMA) & MASK_64;
    let z = etat;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
    z = (z ^ (z >> 31n)) & MASK_64;
    return z;
  }

  function flottant(): number {
    // 53 bits de poids fort → double dans [0, 1)
    const bits = suivant() >> 11n;
    return Number(bits) / Number(1n << 53n);
  }

  function entier(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new Error("rng.entier : bornes non entières");
    }
    if (max < min) {
      throw new Error("rng.entier : max < min");
    }
    const etendue = BigInt(max - min + 1);
    // Rejection sampling pour éliminer le biais de modulo.
    const limite = ((1n << 64n) / etendue) * etendue;
    let v: bigint;
    do {
      v = suivant();
    } while (v >= limite);
    return min + Number(v % etendue);
  }

  function deriver(contexte: string): RNG {
    const graineFille = (grainePropre ^ hashContexte(contexte)) & MASK_64;
    return creerRng(graineFille);
  }

  return { suivant, flottant, entier, deriver };
}
