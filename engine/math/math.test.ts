import { describe, it, expect } from "vitest";
import { puissanceCapacite, puissanceEntiere } from "./index.js";

describe("puissanceEntiere", () => {
  it("x^0 = 1 pour tout x, y compris 0", () => {
    expect(puissanceEntiere(2, 0)).toBe(1);
    expect(puissanceEntiere(1.1, 0)).toBe(1);
    expect(puissanceEntiere(0, 0)).toBe(1);
  });

  it("x^1 = x", () => {
    expect(puissanceEntiere(2, 1)).toBe(2);
    expect(puissanceEntiere(1.1, 1)).toBe(1.1);
  });

  it("1.1^2 exact par multiplication répétée (= 1.1 * 1.1)", () => {
    expect(puissanceEntiere(1.1, 2)).toBe(1.1 * 1.1);
  });

  it("2^10 = 1024", () => {
    expect(puissanceEntiere(2, 10)).toBe(1024);
  });

  it("0^n = 0 pour n >= 1", () => {
    expect(puissanceEntiere(0, 3)).toBe(0);
  });

  it("rejette un exposant négatif", () => {
    expect(() => puissanceEntiere(2, -1)).toThrow();
  });

  it("rejette un exposant non entier", () => {
    expect(() => puissanceEntiere(2, 1.5)).toThrow();
  });
});

describe("puissanceCapacite", () => {
  it("capacite négative ou nulle -> 0", () => {
    expect(puissanceCapacite(-1)).toBe(0);
    expect(puissanceCapacite(0)).toBe(0);
  });

  it("retourne toujours un entier", () => {
    for (const c of [1, 5, 25, 100, 1000]) {
      expect(Number.isInteger(puissanceCapacite(c))).toBe(true);
    }
  });

  it("100^0.7 ≈ 25 (arrondi de 25.11886...)", () => {
    expect(puissanceCapacite(100)).toBe(25);
  });

  it("croît avec la capacité", () => {
    expect(puissanceCapacite(10)).toBeLessThan(puissanceCapacite(100));
    expect(puissanceCapacite(100)).toBeLessThan(puissanceCapacite(1000));
  });
});
