import { describe, it, expect } from "vitest";
import { detecterGoulots } from "./goulots.js";
import type { LieuId, Lien } from "../types/carte.js";

function id(x: string): LieuId {
  return x as LieuId;
}

function route(a: string, b: string): Lien {
  return { a: id(a), b: id(b), nature: "route" };
}

function sentier(a: string, b: string): Lien {
  return { a: id(a), b: id(b), nature: "sentier" };
}

function royaume(...noms: string[]): Set<LieuId> {
  return new Set(noms.map(id));
}

describe("detecterGoulots", () => {
  it("chaîne A-B-C-D-E : seuls B et C sont des goulots (≥ 2 lieux royaume déconnectés)", () => {
    const r = royaume("A", "B", "C", "D", "E");
    const liens = [route("A", "B"), route("B", "C"), route("C", "D"), route("D", "E")];
    // Retirer B : C, D, E inaccessibles → goulot
    // Retirer C : D, E inaccessibles → goulot
    // Retirer D : E inaccessible → pas goulot
    // Retirer E : rien → pas goulot
    const g = [...detecterGoulots(r, liens, id("A"))].sort();
    expect(g).toEqual([id("B"), id("C")].sort());
  });

  it("étoile : aucun goulot", () => {
    const r = royaume("PF", "A", "B", "C", "D");
    const liens = [route("PF", "A"), route("PF", "B"), route("PF", "C"), route("PF", "D")];
    expect(detecterGoulots(r, liens, id("PF"))).toEqual([]);
  });

  it("ignore les sentiers dans le calcul de la connexité", () => {
    // PF - A - B - C par routes, plus un sentier PF - C
    const r = royaume("PF", "A", "B", "C");
    const liens = [route("PF", "A"), route("A", "B"), route("B", "C"), sentier("PF", "C")];
    // Retirer A : B, C inaccessibles via routes seules → 2, goulot
    // Retirer B : C inaccessible via routes seules → 1, pas goulot
    expect(detecterGoulots(r, liens, id("PF"))).toEqual([id("A")]);
  });

  it("la place forte n'est jamais candidate", () => {
    const r = royaume("PF", "A");
    const liens = [route("PF", "A")];
    expect(detecterGoulots(r, liens, id("PF"))).not.toContain(id("PF"));
  });

  it("les fosses ne comptent pas comme lieux royaume déconnectés", () => {
    // "F1" absent de royaumeIds → pas compté
    const r = royaume("PF", "A");
    const liens = [route("PF", "A"), sentier("A", "F1")];
    expect(detecterGoulots(r, liens, id("PF"))).toEqual([]);
  });
});
