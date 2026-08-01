// Tests du module horde — exposition, volume, fronts, doctrines, orchestration.
// Toutes les fonctions sont pures : mêmes entrées, même sortie, toujours.

import { describe, it, expect, beforeAll } from "vitest";
import { chargerConfig } from "../../config/loader.js";
import type { Balance } from "../../config/schema.js";
import type {
  AbordId,
  Lieu,
  Lien,
  LieuId,
  NatureLieu,
  ProvinceId,
  Province,
  TerrainId,
  Abord,
} from "../types/carte.js";
import type { Garnison } from "../types/garnison.js";
import { lieuxExposes } from "./exposes.js";
import { calculerVolume } from "./volume.js";
import { calculerNbFronts } from "./fronts.js";
import {
  DOCTRINES,
  NOMS_DOCTRINES,
  tirerDoctrinesLune,
  type NomDoctrine,
} from "./doctrines/index.js";
import { orchestrerJour } from "./orchestrer.js";

let config: Balance;

beforeAll(() => {
  config = chargerConfig("./config/balance.json");
});

// --- Helpers de construction ----------------------------------------------

function lid(nom: string): LieuId {
  return nom as LieuId;
}

function aid(nom: string): AbordId {
  return nom as AbordId;
}

function abord(nom: string, fortification: number, index = 0): Abord {
  return { id: aid(nom), index_anneau: index, fortification };
}

function lieu(
  nom: string,
  nature: NatureLieu = "feu_de_guet",
  terrain: TerrainId = "plaine",
  tenu: "royaume" | "horde" | "detruit" = "royaume",
  abords: Abord[] = [abord(`a-${nom}`, 0)],
): Lieu {
  return {
    id: lid(nom),
    nature,
    terrain,
    secteur_id: null,
    abords,
    tenu_par: tenu,
  };
}

function route(a: string, b: string): Lien {
  return { a: lid(a), b: lid(b), nature: "route" };
}

function province(
  lieux: readonly Lieu[],
  liens: readonly Lien[],
  entrees: readonly string[],
  entree_principale: string,
  place_forte: string,
): Province {
  return {
    id: "p" as ProvinceId,
    lieux,
    liens,
    entrees: entrees.map(lid),
    entree_principale: lid(entree_principale),
    place_forte_id: lid(place_forte),
    fosses: lieux.filter((l) => l.nature === "fosse").map((l) => l.id),
  };
}

// --- 1. Exposition --------------------------------------------------------

describe("lieuxExposes", () => {
  it("les entrées royaume sont exposées d'office", () => {
    const l1 = lieu("l1");
    const l2 = lieu("l2");
    const exp = lieuxExposes([l1, l2], [route("l1", "l2")], [lid("l1")]);
    expect(exp).toEqual([lid("l1")]);
  });

  it("un lieu royaume adjacent à un lieu horde est exposé", () => {
    const l1 = lieu("l1", "place_forte");
    const l2 = lieu("l2", "feu_de_guet");
    const h1 = lieu("h1", "fosse", "plaine", "horde");
    const exp = lieuxExposes([l1, l2, h1], [route("l1", "l2"), route("l2", "h1")], []);
    expect(exp).toEqual([lid("l2")]);
  });

  it("les lieux royaume à l'intérieur ne sont pas exposés", () => {
    const l1 = lieu("l1", "place_forte");
    const l2 = lieu("l2", "feu_de_guet");
    const exp = lieuxExposes([l1, l2], [route("l1", "l2")], []);
    expect(exp).toEqual([]);
  });

  it("un lieu horde n'apparaît pas dans les exposés", () => {
    const l1 = lieu("l1");
    const h1 = lieu("h1", "fosse", "plaine", "horde");
    const exp = lieuxExposes([l1, h1], [route("l1", "h1")], [lid("h1")]);
    expect(exp).toEqual([lid("l1")]);
  });
});

// --- 2. Volume ------------------------------------------------------------

describe("calculerVolume", () => {
  it("clampe en bas quand la production est nulle", () => {
    const v = calculerVolume({
      production_cumulee_fosses: 0,
      puissance_varhal: 1,
      capacite: 100,
      nb_fronts: 3,
      config,
    });
    expect(v).toBe(config.horde.plancher_intensite);
  });

  it("clampe en haut selon plafond_par_front × nb_fronts", () => {
    const v = calculerVolume({
      production_cumulee_fosses: 1_000_000,
      puissance_varhal: 1_000,
      capacite: 10_000,
      nb_fronts: 4,
      config,
    });
    expect(v).toBe(config.horde.plafond_intensite_par_front * 4);
  });

  it("croît sous-linéairement avec la capacité", () => {
    const v1 = calculerVolume({
      production_cumulee_fosses: 1,
      puissance_varhal: 1,
      capacite: 100,
      nb_fronts: 100,
      config,
    });
    const v10 = calculerVolume({
      production_cumulee_fosses: 1,
      puissance_varhal: 1,
      capacite: 1000,
      nb_fronts: 100,
      config,
    });
    expect(v10).toBeGreaterThan(v1);
    // 10× la capacité doit produire beaucoup moins que 10× le volume (sous-linéaire).
    expect(v10).toBeLessThan(v1 * 10);
  });

  it("rejette nb_fronts < 1", () => {
    expect(() =>
      calculerVolume({
        production_cumulee_fosses: 1,
        puissance_varhal: 1,
        capacite: 100,
        nb_fronts: 0,
        config,
      }),
    ).toThrow();
  });
});

// --- 3. Nombre de fronts --------------------------------------------------

describe("calculerNbFronts", () => {
  it("0 exposés → 0 fronts", () => {
    expect(calculerNbFronts(100, 0, config)).toBe(0);
  });

  it("plancher à 1 même sur toute petite capacité", () => {
    expect(calculerNbFronts(1, 5, config)).toBeGreaterThanOrEqual(1);
  });

  it("plafond au nombre d'exposés", () => {
    expect(calculerNbFronts(100_000, 3, config)).toBe(3);
  });

  it("croît avec la capacité", () => {
    const a = calculerNbFronts(50, 20, config);
    const b = calculerNbFronts(500, 20, config);
    expect(b).toBeGreaterThanOrEqual(a);
  });
});

// --- 4. Tirage des doctrines ----------------------------------------------

describe("tirerDoctrinesLune", () => {
  it("tire doctrines_par_lune noms distincts", () => {
    const actives = tirerDoctrinesLune(42n, config);
    expect(actives).toHaveLength(config.horde.doctrines_par_lune);
    expect(new Set(actives).size).toBe(actives.length);
  });

  it("déterministe : même graine, même tirage", () => {
    const a = tirerDoctrinesLune(1234n, config);
    const b = tirerDoctrinesLune(1234n, config);
    expect(a).toEqual(b);
  });

  it("dépend de la graine (deux graines différentes ne donnent pas systématiquement le même tirage)", () => {
    const tirages = new Set<string>();
    for (let i = 0n; i < 20n; i++) tirages.add(tirerDoctrinesLune(i, config).join(","));
    expect(tirages.size).toBeGreaterThan(1);
  });

  it("noms de doctrine tous connus", () => {
    for (const d of tirerDoctrinesLune(7n, config)) {
      expect(NOMS_DOCTRINES).toContain(d);
    }
  });
});

// --- 5. Doctrines : règles de ciblage -------------------------------------

describe("marteau : préfère le lieu le plus fortifié", () => {
  it("classe les exposés par fortification totale décroissante", () => {
    const l1 = lieu("l1", "feu_de_guet", "plaine", "royaume", [abord("a1", 1)]);
    const l2 = lieu("l2", "place_forte", "plaine", "royaume", [
      abord("a2a", 3),
      abord("a2b", 3),
      abord("a2c", 3),
    ]);
    const l3 = lieu("l3", "poste_avance", "plaine", "royaume", [abord("a3", 0)]);
    const prov = province([l1, l2, l3], [], ["l1"], "l1", "l2");
    const ordre = DOCTRINES.marteau.preferer([lid("l1"), lid("l2"), lid("l3")], {
      jour: 1,
      graine_lune: 0n,
      province: prov,
      garnisons: new Map(),
      volumes_par_front: [],
    });
    expect(ordre[0]).toBe(lid("l2"));
    expect(ordre[2]).toBe(lid("l3"));
  });

  it("choisit l'abord le plus fortifié", () => {
    const l = lieu("l", "place_forte", "plaine", "royaume", [
      abord("a", 1),
      abord("b", 3),
      abord("c", 2),
    ]);
    const prov = province([l], [], ["l"], "l", "l");
    const abordId = DOCTRINES.marteau.choisirAbord(l, {
      jour: 1,
      graine_lune: 0n,
      province: prov,
      garnisons: new Map(),
      volumes_par_front: [],
    });
    expect(abordId).toBe(aid("b"));
  });
});

describe("ecorcheurs : le moins fortifié partout", () => {
  it("classe par fortification totale croissante", () => {
    const l1 = lieu("l1", "feu_de_guet", "plaine", "royaume", [abord("a1", 1)]);
    const l2 = lieu("l2", "poste_avance", "plaine", "royaume", [abord("a2", 0)]);
    const prov = province([l1, l2], [], [], "l1", "l1");
    const ordre = DOCTRINES.ecorcheurs.preferer([lid("l1"), lid("l2")], {
      jour: 1,
      graine_lune: 0n,
      province: prov,
      garnisons: new Map(),
      volumes_par_front: [],
    });
    expect(ordre[0]).toBe(lid("l2"));
  });

  it("choisit l'abord le moins fortifié", () => {
    const l = lieu("l", "place_forte", "plaine", "royaume", [
      abord("a", 3),
      abord("b", 1),
      abord("c", 2),
    ]);
    const prov = province([l], [], [], "l", "l");
    expect(
      DOCTRINES.ecorcheurs.choisirAbord(l, {
        jour: 1,
        graine_lune: 0n,
        province: prov,
        garnisons: new Map(),
        volumes_par_front: [],
      }),
    ).toBe(aid("b"));
  });
});

describe("meute : le plus faiblement garni", () => {
  it("classe par effectif garnison croissant", () => {
    const l1 = lieu("l1", "feu_de_guet");
    const l2 = lieu("l2", "feu_de_guet");
    const prov = province([l1, l2], [], [], "l1", "l1");
    const garnisons = new Map<LieuId, Garnison>([
      [
        lid("l1"),
        {
          lieu_id: lid("l1"),
          paquets: [{ abord_id: aid("a-l1"), joueurs: [], effectif: 10, posture: "mur" }],
          reserve: [],
        },
      ],
      [
        lid("l2"),
        {
          lieu_id: lid("l2"),
          paquets: [{ abord_id: aid("a-l2"), joueurs: [], effectif: 1, posture: "mur" }],
          reserve: [],
        },
      ],
    ]);
    const ordre = DOCTRINES.meute.preferer([lid("l1"), lid("l2")], {
      jour: 1,
      graine_lune: 0n,
      province: prov,
      garnisons,
      volumes_par_front: [],
    });
    expect(ordre[0]).toBe(lid("l2"));
  });

  it("choisit l'abord le moins garni", () => {
    const l = lieu("l", "place_forte", "plaine", "royaume", [
      abord("a", 0),
      abord("b", 0),
      abord("c", 0),
    ]);
    const prov = province([l], [], [], "l", "l");
    const g: Garnison = {
      lieu_id: lid("l"),
      paquets: [
        { abord_id: aid("a"), joueurs: [], effectif: 5, posture: "mur" },
        { abord_id: aid("b"), joueurs: [], effectif: 1, posture: "mur" },
        { abord_id: aid("c"), joueurs: [], effectif: 3, posture: "mur" },
      ],
      reserve: [],
    };
    expect(
      DOCTRINES.meute.choisirAbord(l, {
        jour: 1,
        graine_lune: 0n,
        province: prov,
        garnisons: new Map([[lid("l"), g]]),
        volumes_par_front: [],
      }),
    ).toBe(aid("b"));
  });
});

describe("garde : entrée principale prioritaire", () => {
  it("met entree_principale en tête si elle est exposée", () => {
    const l1 = lieu("l1");
    const l2 = lieu("l2");
    const prov = province([l1, l2], [route("l1", "l2")], ["l1"], "l1", "l2");
    const ordre = DOCTRINES.garde.preferer([lid("l1"), lid("l2")], {
      jour: 1,
      graine_lune: 0n,
      province: prov,
      garnisons: new Map(),
      volumes_par_front: [],
    });
    expect(ordre[0]).toBe(lid("l1"));
  });

  it("tombée l'entrée, prend le plus proche BFS", () => {
    const l1 = lieu("l1", "feu_de_guet", "plaine", "horde"); // tombée
    const l2 = lieu("l2");
    const l3 = lieu("l3");
    const prov = province([l1, l2, l3], [route("l1", "l2"), route("l2", "l3")], ["l1"], "l1", "l3");
    const ordre = DOCTRINES.garde.preferer([lid("l2"), lid("l3")], {
      jour: 1,
      graine_lune: 0n,
      province: prov,
      garnisons: new Map(),
      volumes_par_front: [],
    });
    expect(ordre[0]).toBe(lid("l2"));
  });
});

describe("serpent : rotation d'abord par lune", () => {
  it("préfère la place forte si exposée", () => {
    const l1 = lieu("l1");
    const pf = lieu("pf", "place_forte", "plaine", "royaume", [abord("a", 3), abord("b", 3)]);
    const prov = province([l1, pf], [route("l1", "pf")], ["l1"], "l1", "pf");
    const ordre = DOCTRINES.serpent.preferer([lid("l1"), lid("pf")], {
      jour: 1,
      graine_lune: 0n,
      province: prov,
      garnisons: new Map(),
      volumes_par_front: [],
    });
    expect(ordre[0]).toBe(lid("pf"));
  });

  it("permutation stable dans une lune", () => {
    const pf = lieu("pf", "place_forte", "plaine", "royaume", [
      abord("a", 3),
      abord("b", 3),
      abord("c", 3),
    ]);
    const prov = province([pf], [], [], "pf", "pf");
    const abords: AbordId[] = [];
    for (let j = 1; j <= 6; j++) {
      abords.push(
        DOCTRINES.serpent.choisirAbord(pf, {
          jour: j,
          graine_lune: 42n,
          province: prov,
          garnisons: new Map(),
          volumes_par_front: [],
        }),
      );
    }
    // Sur 3 abords, la séquence est périodique de période 3.
    expect(abords[3]).toBe(abords[0]);
    expect(abords[4]).toBe(abords[1]);
    expect(abords[5]).toBe(abords[2]);
    // Elle couvre les 3 abords sur une période.
    expect(new Set(abords.slice(0, 3)).size).toBe(3);
  });

  it("permutation différente selon la graine de lune", () => {
    const pf = lieu("pf", "place_forte", "plaine", "royaume", [
      abord("a", 3),
      abord("b", 3),
      abord("c", 3),
    ]);
    const prov = province([pf], [], [], "pf", "pf");
    const permA: AbordId[] = [];
    const permB: AbordId[] = [];
    for (let j = 1; j <= 3; j++) {
      permA.push(
        DOCTRINES.serpent.choisirAbord(pf, {
          jour: j,
          graine_lune: 1n,
          province: prov,
          garnisons: new Map(),
          volumes_par_front: [],
        }),
      );
      permB.push(
        DOCTRINES.serpent.choisirAbord(pf, {
          jour: j,
          graine_lune: 999_999n,
          province: prov,
          garnisons: new Map(),
          volumes_par_front: [],
        }),
      );
    }
    // Au moins une des deux permutations diffère.
    expect(permA.join(",")).not.toBe(permB.join(","));
  });
});

// --- 6. Orchestration -----------------------------------------------------

describe("orchestrerJour : cas ordinaire", () => {
  function scenarioSimple() {
    // 3 exposés : entrée + 2 périphériques adjacents à un lieu horde.
    const entree = lieu("entree", "feu_de_guet");
    const flanc1 = lieu("flanc1", "feu_de_guet");
    const flanc2 = lieu("flanc2", "feu_de_guet");
    const pf = lieu("pf", "place_forte", "plaine", "royaume", [
      abord("pf-a", 3),
      abord("pf-b", 3),
      abord("pf-c", 3),
    ]);
    const interne = lieu("interne", "poste_avance"); // non exposé
    const h1 = lieu("h1", "fosse", "plaine", "horde");
    const prov = province(
      [entree, flanc1, flanc2, pf, interne, h1],
      [
        route("entree", "pf"),
        route("flanc1", "pf"),
        route("flanc2", "pf"),
        route("interne", "pf"),
        route("flanc1", "h1"),
        route("flanc2", "h1"),
      ],
      ["entree"],
      "entree",
      "pf",
    );
    return prov;
  }

  it("aucune vague si zéro exposé", () => {
    const l = lieu("solo", "place_forte");
    const prov = province([l], [], [], "solo", "solo");
    const out = orchestrerJour({
      jour: 1,
      graine_lune: 1n,
      province: prov,
      garnisons: new Map(),
      volume_total: 100,
      nb_fronts: 3,
      config,
    });
    expect(out.vagues).toHaveLength(0);
  });

  it("un jour ordinaire produit exactement nb_fronts vagues (bornées par les exposés)", () => {
    const prov = scenarioSimple();
    const out = orchestrerJour({
      jour: 5,
      graine_lune: 42n,
      province: prov,
      garnisons: new Map(),
      volume_total: 60,
      nb_fronts: 3,
      config,
      doctrines_actives: ["marteau", "ecorcheurs", "rouleau"],
    });
    // 3 exposés : entree, flanc1, flanc2. nb_fronts=3 → 3 vagues.
    expect(out.vagues).toHaveLength(3);
    expect(out.est_offensive).toBe(false);
    // Une vague par lieu (jamais deux sur le même).
    const lieux = out.vagues.map((v) => v.lieu_id);
    expect(new Set(lieux).size).toBe(lieux.length);
  });

  it("déterministe : même entrée, même sortie", () => {
    const prov = scenarioSimple();
    const entree = {
      jour: 5,
      graine_lune: 99n,
      province: prov,
      garnisons: new Map(),
      volume_total: 60,
      nb_fronts: 3,
      config,
      doctrines_actives: ["marteau", "ecorcheurs", "rouleau"] as NomDoctrine[],
    };
    const a = orchestrerJour(entree);
    const b = orchestrerJour(entree);
    expect(a.vagues).toEqual(b.vagues);
    expect(a.doctrines_par_vague).toEqual(b.doctrines_par_vague);
  });
});

describe("orchestrerJour : offensive de fin d'acte", () => {
  it("J10 : tous les exposés attaqués par un seul lieutenant", () => {
    const l1 = lieu("l1");
    const l2 = lieu("l2");
    const l3 = lieu("l3");
    const pf = lieu("pf", "place_forte", "plaine", "royaume", [
      abord("pf-a", 3),
      abord("pf-b", 3),
      abord("pf-c", 3),
    ]);
    const h1 = lieu("h1", "fosse", "plaine", "horde");
    const prov = province(
      [l1, l2, l3, pf, h1],
      [
        route("l1", "pf"),
        route("l2", "pf"),
        route("l3", "pf"),
        route("l1", "h1"),
        route("l2", "h1"),
        route("l3", "h1"),
      ],
      ["l1"],
      "l1",
      "pf",
    );
    const out = orchestrerJour({
      jour: 10,
      graine_lune: 42n,
      province: prov,
      garnisons: new Map(),
      volume_total: 60,
      nb_fronts: 1, // ignoré en offensive
      config,
      doctrines_actives: ["marteau", "ecorcheurs", "rouleau"],
    });
    expect(out.est_offensive).toBe(true);
    // 3 exposés → 3 vagues (tous attaqués).
    expect(out.vagues).toHaveLength(3);
    // Toutes par la même doctrine (lieutenant de l'acte 1).
    expect(new Set(out.doctrines_par_vague).size).toBe(1);
    expect(out.doctrines_par_vague[0]).toBe("marteau");
  });

  it("J20 : lieutenant de l'acte 2", () => {
    const l1 = lieu("l1");
    const h1 = lieu("h1", "fosse", "plaine", "horde");
    const prov = province([l1, h1], [route("l1", "h1")], ["l1"], "l1", "l1");
    const out = orchestrerJour({
      jour: 20,
      graine_lune: 42n,
      province: prov,
      garnisons: new Map(),
      volume_total: 60,
      nb_fronts: 1,
      config,
      doctrines_actives: ["marteau", "ecorcheurs", "rouleau"],
    });
    expect(out.doctrines_par_vague[0]).toBe("ecorcheurs");
  });
});
