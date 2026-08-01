import { describe, it, expect } from "vitest";
import { calculerFragilite, fragiliteMaximale, fragiliteParRang } from "./fragilite.js";
import type { Lien, LieuId } from "../types/carte.js";

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

describe("calculerFragilite", () => {
  it("chaîne PF-A-B-C-D : fragilité(A)=3, (B)=2, (C)=1, (D)=0", () => {
    const r = royaume("PF", "A", "B", "C", "D");
    const liens = [route("PF", "A"), route("A", "B"), route("B", "C"), route("C", "D")];
    const impacts = calculerFragilite(r, liens, id("PF"));
    const map = new Map(impacts.map((i) => [i.lieu_id, i.coupes]));
    expect(map.get(id("A"))).toBe(3);
    expect(map.get(id("B"))).toBe(2);
    expect(map.get(id("C"))).toBe(1);
    expect(map.get(id("D"))).toBe(0);
  });

  it("étoile PF - {A,B,C,D} : tous les enfants ont fragilité 0", () => {
    const r = royaume("PF", "A", "B", "C", "D");
    const liens = [route("PF", "A"), route("PF", "B"), route("PF", "C"), route("PF", "D")];
    const impacts = calculerFragilite(r, liens, id("PF"));
    for (const i of impacts) expect(i.coupes).toBe(0);
  });

  it("PF avec deux enfants, chacun avec un sous-arbre : chaque enfant coupe son sous-arbre", () => {
    // PF - A - {B, C} et PF - D - E
    const r = royaume("PF", "A", "B", "C", "D", "E");
    const liens = [
      route("PF", "A"),
      route("A", "B"),
      route("A", "C"),
      route("PF", "D"),
      route("D", "E"),
    ];
    const impacts = calculerFragilite(r, liens, id("PF"));
    const map = new Map(impacts.map((i) => [i.lieu_id, i.coupes]));
    expect(map.get(id("A"))).toBe(2); // B et C
    expect(map.get(id("D"))).toBe(1); // E
    expect(map.get(id("B"))).toBe(0);
    expect(map.get(id("C"))).toBe(0);
    expect(map.get(id("E"))).toBe(0);
  });

  it("une route redondante réduit la fragilité", () => {
    // PF - A - B, plus une route PF - B : perdre A ne coupe plus B
    const r = royaume("PF", "A", "B");
    const sansRedondance = calculerFragilite(r, [route("PF", "A"), route("A", "B")], id("PF"));
    const avec = calculerFragilite(
      r,
      [route("PF", "A"), route("A", "B"), route("PF", "B")],
      id("PF"),
    );
    const mapSans = new Map(sansRedondance.map((i) => [i.lieu_id, i.coupes]));
    const mapAvec = new Map(avec.map((i) => [i.lieu_id, i.coupes]));
    expect(mapSans.get(id("A"))).toBe(1);
    expect(mapAvec.get(id("A"))).toBe(0);
  });

  it("les sentiers ne comptent pas pour la fragilité", () => {
    // PF - A - B en routes, sentier PF - B en plus : perdre A coupe toujours B
    const r = royaume("PF", "A", "B");
    const impacts = calculerFragilite(
      r,
      [route("PF", "A"), route("A", "B"), sentier("PF", "B")],
      id("PF"),
    );
    const map = new Map(impacts.map((i) => [i.lieu_id, i.coupes]));
    expect(map.get(id("A"))).toBe(1);
  });

  it("la place forte n'est jamais dans la liste des impacts", () => {
    const r = royaume("PF", "A");
    const impacts = calculerFragilite(r, [route("PF", "A")], id("PF"));
    for (const i of impacts) expect(i.lieu_id).not.toBe(id("PF"));
  });
});

describe("fragiliteMaximale", () => {
  it("retourne 0 sur une liste vide", () => {
    expect(fragiliteMaximale([])).toBe(0);
  });
  it("retourne le max des coupes", () => {
    expect(
      fragiliteMaximale([
        { lieu_id: id("A"), coupes: 3 },
        { lieu_id: id("B"), coupes: 7 },
        { lieu_id: id("C"), coupes: 2 },
      ]),
    ).toBe(7);
  });
});

describe("fragiliteParRang", () => {
  it("trie par coupes décroissantes, puis par id croissant", () => {
    const r = fragiliteParRang([
      { lieu_id: id("A"), coupes: 3 },
      { lieu_id: id("B"), coupes: 7 },
      { lieu_id: id("C"), coupes: 3 },
    ]);
    expect(r.map((i) => i.lieu_id)).toEqual([id("B"), id("A"), id("C")]);
  });
});
