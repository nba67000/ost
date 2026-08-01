import { describe, it, expect } from "vitest";
import { detecterGoulots } from "./goulots.js";
import type { AbordId, Lien, Lieu, LieuId, Province, ProvinceId } from "../types/carte.js";

function id(x: string): LieuId {
  return x as LieuId;
}

function lieuRoyaume(nom: string): Lieu {
  return {
    id: id(nom),
    nature: "feu_de_guet",
    terrain: "plaine",
    secteur_id: null,
    abords: [{ id: `abord-${nom}` as AbordId, index_anneau: 0, fortification: 0 }],
    tenu_par: "royaume",
  };
}

function fosse(nom: string): Lieu {
  return {
    id: id(nom),
    nature: "fosse",
    terrain: "plaine",
    secteur_id: null,
    abords: [],
    tenu_par: "horde",
  };
}

function route(a: string, b: string): Lien {
  return { a: id(a), b: id(b), nature: "route" };
}

function sentier(a: string, b: string): Lien {
  return { a: id(a), b: id(b), nature: "sentier" };
}

function province(opts: {
  lieux: Lieu[];
  liens: Lien[];
  place_forte: string;
  entrees?: string[];
  fosses?: string[];
}): Province {
  const entrees = (opts.entrees ?? []).map(id);
  return {
    id: "p" as ProvinceId,
    lieux: opts.lieux,
    liens: opts.liens,
    entrees,
    entree_principale: entrees[0] ?? id(opts.place_forte),
    place_forte_id: id(opts.place_forte),
    fosses: (opts.fosses ?? []).map(id),
  };
}

describe("detecterGoulots", () => {
  it("chaîne A-B-C-D-E : seuls B et C sont des goulots (≥ 2 lieux royaume déconnectés)", () => {
    const p = province({
      lieux: ["A", "B", "C", "D", "E"].map(lieuRoyaume),
      liens: [route("A", "B"), route("B", "C"), route("C", "D"), route("D", "E")],
      place_forte: "A",
      entrees: ["E"],
    });
    // Retirer B : C, D, E inaccessibles → 3, goulot
    // Retirer C : D, E inaccessibles → 2, goulot
    // Retirer D : E inaccessible → 1, pas goulot
    // Retirer E : rien → pas goulot
    const g = [...detecterGoulots(p)].sort();
    expect(g).toEqual([id("B"), id("C")].sort());
  });

  it("étoile : aucun goulot", () => {
    const p = province({
      lieux: ["PF", "A", "B", "C", "D"].map(lieuRoyaume),
      liens: [route("PF", "A"), route("PF", "B"), route("PF", "C"), route("PF", "D")],
      place_forte: "PF",
    });
    expect(detecterGoulots(p)).toEqual([]);
  });

  it("ignore les sentiers dans le calcul de la connexité", () => {
    // PF - A - B - C par routes, plus un sentier PF - C
    const p = province({
      lieux: ["PF", "A", "B", "C"].map(lieuRoyaume),
      liens: [route("PF", "A"), route("A", "B"), route("B", "C"), sentier("PF", "C")],
      place_forte: "PF",
    });
    // Retirer A : B, C inaccessibles via routes seules → 2, goulot
    // Retirer B : C inaccessible via routes seules → 1, pas goulot
    expect(detecterGoulots(p)).toEqual([id("A")]);
  });

  it("la place forte n'est jamais candidate", () => {
    const p = province({
      lieux: ["PF", "A"].map(lieuRoyaume),
      liens: [route("PF", "A")],
      place_forte: "PF",
    });
    expect(detecterGoulots(p)).not.toContain(id("PF"));
  });

  it("les fosses ne comptent pas comme lieux royaume déconnectés", () => {
    // Une Fosse pendue au bout : retirer A ne coupe qu'elle → pas goulot
    const p = province({
      lieux: [lieuRoyaume("PF"), lieuRoyaume("A"), fosse("F1")],
      liens: [route("PF", "A"), sentier("A", "F1")],
      place_forte: "PF",
      fosses: ["F1"],
    });
    expect(detecterGoulots(p)).toEqual([]);
  });
});
