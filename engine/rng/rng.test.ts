import { describe, it, expect } from "vitest";
import { creerRng } from "./index.js";

describe("rng — reproductibilité", () => {
  it("produit la même séquence pour la même graine", () => {
    const a = creerRng(42n);
    const b = creerRng(42n);
    const suiteA = Array.from({ length: 20 }, () => a.suivant());
    const suiteB = Array.from({ length: 20 }, () => b.suivant());
    expect(suiteA).toEqual(suiteB);
  });

  it("diverge pour deux graines distinctes", () => {
    const a = creerRng(1n);
    const b = creerRng(2n);
    expect(a.suivant()).not.toEqual(b.suivant());
  });
});

describe("rng — dérivation par contexte", () => {
  it("dérive un flux distinct par contexte", () => {
    const combat = creerRng(42n).deriver("combat");
    const carte = creerRng(42n).deriver("carte");
    expect(combat.suivant()).not.toEqual(carte.suivant());
  });

  it("dérive de manière stable, indépendamment de l'usage du parent", () => {
    const p1 = creerRng(42n);
    const p2 = creerRng(42n);
    // On fait avancer p2 avant de dériver
    p2.suivant();
    p2.suivant();
    p2.suivant();
    const a = p1.deriver("combat").suivant();
    const b = p2.deriver("combat").suivant();
    expect(a).toEqual(b);
  });

  it("dérive deux fois du même contexte renvoie le même flux", () => {
    const p = creerRng(42n);
    const a = p.deriver("combat").suivant();
    const b = p.deriver("combat").suivant();
    expect(a).toEqual(b);
  });

  it("la dérivation à profondeur variable reste déterministe", () => {
    const a = creerRng(42n).deriver("lune-1").deriver("combat").deriver("assaut-3").suivant();
    const b = creerRng(42n).deriver("lune-1").deriver("combat").deriver("assaut-3").suivant();
    expect(a).toEqual(b);
  });
});

describe("rng — bornes", () => {
  it("flottant() reste dans [0, 1)", () => {
    const r = creerRng(42n);
    for (let i = 0; i < 1000; i++) {
      const f = r.flottant();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it("entier(min, max) reste dans les bornes inclusives", () => {
    const r = creerRng(42n);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const n = r.entier(3, 7);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
      seen.add(n);
    }
    // On finit par toucher chaque valeur — indice qu'il n'y a pas de biais grossier.
    expect(seen.size).toBe(5);
  });

  it("entier(x, x) renvoie x", () => {
    const r = creerRng(42n);
    expect(r.entier(7, 7)).toBe(7);
    expect(r.entier(7, 7)).toBe(7);
  });

  it("rejette max < min", () => {
    const r = creerRng(42n);
    expect(() => r.entier(5, 3)).toThrow();
  });

  it("rejette les bornes non entières", () => {
    const r = creerRng(42n);
    expect(() => r.entier(1.5, 3)).toThrow();
  });
});
