import { describe, it, expect, beforeAll } from "vitest";
import { chargerConfig } from "../../config/loader.js";
import type { Balance } from "../../config/schema.js";
import { appliquerJour, calculerApprovisionnement, coefAffamee } from "./index.js";
import type { AbordId, Lieu, LieuId, Lien, NatureLieu, TerrainId } from "../types/carte.js";

let config: Balance;

beforeAll(() => {
  config = chargerConfig("./config/balance.json");
});

// --- Helpers de construction ----------------------------------------------

function id(nom: string): LieuId {
  return nom as LieuId;
}

function lieu(
  nom: string,
  nature: NatureLieu = "feu_de_guet",
  terrain: TerrainId = "plaine",
  tenu: "royaume" | "horde" | "detruit" = "royaume",
): Lieu {
  return {
    id: id(nom),
    nature,
    terrain,
    secteur_id: null,
    abords: [{ id: `a-${nom}` as AbordId, index_anneau: 0, fortification: 0 }],
    tenu_par: tenu,
  };
}

function route(a: string, b: string): Lien {
  return { a: id(a), b: id(b), nature: "route" };
}

function sentier(a: string, b: string): Lien {
  return { a: id(a), b: id(b), nature: "sentier" };
}

// --- calculerApprovisionnement --------------------------------------------

describe("calculerApprovisionnement", () => {
  it("un lieu relié uniquement par sentier n'est jamais approvisionné", () => {
    const lieux = [lieu("PF", "place_forte"), lieu("A"), lieu("B")];
    const liens = [route("PF", "A"), sentier("PF", "B")];
    const r = calculerApprovisionnement(lieux, liens, id("PF"), config);
    expect(r.approvisionnes.has(id("A"))).toBe(true);
    expect(r.approvisionnes.has(id("B"))).toBe(false);
    expect(r.recharge.has(id("B"))).toBe(false);
  });

  it("la perte d'un goulot (mis en horde) coupe tout son sous-arbre", () => {
    const base = [lieu("PF", "place_forte"), lieu("A"), lieu("B"), lieu("C")];
    const liens = [route("PF", "A"), route("A", "B"), route("B", "C")];

    const avant = calculerApprovisionnement(base, liens, id("PF"), config);
    expect(avant.approvisionnes.size).toBe(4);

    const modifie = base.map((l) => (l.id === id("A") ? { ...l, tenu_par: "horde" as const } : l));
    const apres = calculerApprovisionnement(modifie, liens, id("PF"), config);
    expect(apres.approvisionnes.has(id("PF"))).toBe(true);
    expect(apres.approvisionnes.has(id("A"))).toBe(false);
    expect(apres.approvisionnes.has(id("B"))).toBe(false);
    expect(apres.approvisionnes.has(id("C"))).toBe(false);
  });

  it("terrain marais : recharge divisée par 2 (1 au lieu de 2)", () => {
    const lieux = [lieu("PF", "place_forte"), lieu("A", "feu_de_guet", "marais")];
    const liens = [route("PF", "A")];
    const r = calculerApprovisionnement(lieux, liens, id("PF"), config);
    expect(r.recharge.get(id("PF"))).toBe(2);
    expect(r.recharge.get(id("A"))).toBe(1);
  });

  it("place forte perdue : personne n'est approvisionné", () => {
    const lieux = [lieu("PF", "place_forte", "plaine", "horde"), lieu("A")];
    const liens = [route("PF", "A")];
    const r = calculerApprovisionnement(lieux, liens, id("PF"), config);
    expect(r.approvisionnes.size).toBe(0);
    expect(r.recharge.size).toBe(0);
  });

  it("ne traverse pas un lieu horde intermédiaire", () => {
    const lieux = [
      lieu("PF", "place_forte"),
      lieu("X", "feu_de_guet", "plaine", "horde"),
      lieu("A"),
    ];
    const liens = [route("PF", "X"), route("X", "A")];
    const r = calculerApprovisionnement(lieux, liens, id("PF"), config);
    expect(r.approvisionnes.has(id("A"))).toBe(false);
  });
});

// --- coefAffamee (bornes exactes) -----------------------------------------

describe("coefAffamee — bornes exactes (seuil=2, facteur=0.6)", () => {
  it("vivres ≥ seuil → 1.0", () => {
    expect(coefAffamee(5, config)).toBeCloseTo(1.0, 10);
    expect(coefAffamee(2, config)).toBeCloseTo(1.0, 10);
  });
  it("1 jour → 0.8", () => {
    expect(coefAffamee(1, config)).toBeCloseTo(0.8, 10);
  });
  it("0 jour → 0.6", () => {
    expect(coefAffamee(0, config)).toBeCloseTo(0.6, 10);
  });
  it("vivres négatifs → 0.6 (plancher)", () => {
    expect(coefAffamee(-1, config)).toBeCloseTo(0.6, 10);
    expect(coefAffamee(-10, config)).toBeCloseTo(0.6, 10);
  });
});

// --- appliquerJour --------------------------------------------------------

describe("appliquerJour", () => {
  const A = id("A");
  const B = id("B");

  function fabriquer(overrides?: {
    vivres?: [LieuId, number][];
    approvisionnes?: LieuId[];
    recharge?: [LieuId, number][];
    assauts?: LieuId[];
    natures?: [LieuId, NatureLieu][];
    garnisons?: [LieuId, number][];
  }) {
    return {
      vivres_par_lieu: new Map(overrides?.vivres ?? [[A, 5]]),
      approvisionnes: new Set(overrides?.approvisionnes ?? [A]),
      recharge: new Map(overrides?.recharge ?? [[A, 2]]),
      assauts_du_jour: new Set(overrides?.assauts ?? []),
      natures: new Map(overrides?.natures ?? [[A, "feu_de_guet" as NatureLieu]]),
      garnisons_effectif: new Map(overrides?.garnisons ?? [[A, 10]]),
      config,
    };
  }

  it("consomme 1 jour si tenu, ajoute la recharge, plafonne à la capacité", () => {
    // capacité feu_de_guet = 6, vivres=5, conso=1, recharge=2 → 5-1+2=6, ok
    const s = appliquerJour(fabriquer({ vivres: [[A, 5]] }));
    expect(s.vivres.get(A)).toBe(6);
  });

  it("consomme 2 jours si tenu + assaut ce jour-là", () => {
    const s = appliquerJour(
      fabriquer({
        vivres: [[A, 5]],
        assauts: [A],
        recharge: [[A, 0]],
        approvisionnes: [],
      }),
    );
    expect(s.vivres.get(A)).toBe(3);
  });

  it("consomme 0 si vide (garnison = 0)", () => {
    const s = appliquerJour(
      fabriquer({
        vivres: [[A, 5]],
        garnisons: [[A, 0]],
        recharge: [[A, 0]],
        approvisionnes: [],
        assauts: [A], // même en cas d'assaut, un lieu vide ne consomme pas
      }),
    );
    expect(s.vivres.get(A)).toBe(5);
  });

  it("recharge plafonnée par la capacité (feu_de_guet = 6)", () => {
    const s = appliquerJour(
      fabriquer({
        vivres: [[A, 5]],
        recharge: [[A, 5]], // 5-1+5=9 sans plafond
      }),
    );
    expect(s.vivres.get(A)).toBe(6);
  });

  it("marais : recharge 1 au lieu de 2, plafond inchangé", () => {
    // On simule ce que produirait calculerApprovisionnement pour un marais
    // (recharge=1), en gardant la capacité feu_de_guet.
    const s = appliquerJour(
      fabriquer({
        vivres: [[A, 5]],
        recharge: [[A, 1]],
      }),
    );
    expect(s.vivres.get(A)).toBe(5); // 5-1+1=5
  });

  it("lieu isolé décroît jusqu'à 0 et s'y maintient", () => {
    let vivres = new Map<LieuId, number>([[A, 3]]);
    for (let i = 0; i < 10; i++) {
      const s = appliquerJour({
        vivres_par_lieu: vivres,
        approvisionnes: new Set(),
        recharge: new Map(),
        assauts_du_jour: new Set(),
        natures: new Map([[A, "feu_de_guet"]]),
        garnisons_effectif: new Map([[A, 10]]),
        config,
      });
      vivres = new Map(s.vivres);
    }
    expect(vivres.get(A)).toBe(0);
  });

  it("idempotence : deux appels identiques sur le même input donnent la même sortie", () => {
    const e = fabriquer();
    const s1 = appliquerJour(e);
    const s2 = appliquerJour(e);
    expect([...s1.vivres.entries()]).toEqual([...s2.vivres.entries()]);
    expect([...s1.coef_ravitaillement.entries()]).toEqual([...s2.coef_ravitaillement.entries()]);
  });

  it("coef_ravitaillement suit coefAffamee sur la sortie vivres", () => {
    const s = appliquerJour(
      fabriquer({
        vivres: [
          [A, 5],
          [B, 1],
        ],
        approvisionnes: [],
        recharge: [],
        natures: [
          [A, "feu_de_guet"],
          [B, "feu_de_guet"],
        ],
        garnisons: [
          [A, 10],
          [B, 10],
        ],
      }),
    );
    // A : 5-1 = 4, coef = 1.0
    // B : 1-1 = 0, coef = 0.6
    expect(s.vivres.get(A)).toBe(4);
    expect(s.coef_ravitaillement.get(A)).toBeCloseTo(1.0, 10);
    expect(s.vivres.get(B)).toBe(0);
    expect(s.coef_ravitaillement.get(B)).toBeCloseTo(0.6, 10);
  });

  it("un lieu absent des natures est ignoré (ne produit rien en sortie)", () => {
    const s = appliquerJour(
      fabriquer({
        vivres: [
          [A, 5],
          [id("inconnu"), 3],
        ],
        approvisionnes: [A],
        recharge: [[A, 2]],
        natures: [[A, "feu_de_guet"]],
        garnisons: [[A, 5]],
      }),
    );
    expect(s.vivres.has(id("inconnu"))).toBe(false);
    expect(s.vivres.has(A)).toBe(true);
  });
});
