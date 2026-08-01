// Arithmétique déterministe pour /engine.
//
// ECMAScript ne fixe pas le dernier bit de Math.pow ni de l'opérateur **.
// Deux versions de Node peuvent donc différer d'un ulp sur ces opérations.
// Sur une valeur au bord d'une borne (seuil de rupture, cible de goulots),
// cette différence peut basculer le résultat.
//
// Règle : dans /engine, toute puissance entière passe par `puissanceEntiere`.
// Le seul appel à Math.pow toléré est isolé dans `puissanceCapacite` et son
// résultat est immédiatement arrondi à l'entier — l'arrondi absorbe la
// différence de dernier bit.

/**
 * base ** exposant, pour un exposant entier positif ou nul.
 * Résultat exact par multiplication répétée, indépendant de la version du moteur.
 */
export function puissanceEntiere(base: number, exposant: number): number {
  if (!Number.isInteger(exposant) || exposant < 0) {
    throw new Error(`puissanceEntiere : exposant doit être un entier >= 0, reçu ${exposant}`);
  }
  let r = 1;
  for (let i = 0; i < exposant; i++) r *= base;
  return r;
}

/**
 * Adaptation de la horde : `round(capacite^0.7)` — voir RULES §7.
 *
 * **Unique point non exactement spécifié du moteur.** L'exposant fractionnaire
 * dépend de l'implémentation Math.pow. On l'isole ici, et on arrondit
 * immédiatement le résultat à l'entier pour absorber la différence de dernier
 * bit entre versions de Node.
 *
 * Toute autre puissance dans /engine doit passer par `puissanceEntiere`.
 */
export function puissanceCapacite(capacite: number): number {
  if (capacite <= 0) return 0;
  return Math.round(Math.pow(capacite, 0.7));
}
