// Tests unitaires des politiques : chaque robot sur un état minimal.

import { describe, it, expect, beforeAll } from "vitest";
import { chargerConfig } from "../../config/loader.js";
import type { Balance } from "../../config/schema.js";
import type {
  AbordId,
  Lieu,
  LieuId,
  Lien,
  Province,
  ProvinceId,
  Abord,
  NatureLieu,
} from "../../engine/types/carte.js";
import type { Garnison, JoueurId } from "../../engine/types/garnison.js";
import type { EtatCampagne, EtatJoueur } from "../../engine/types/campagne.js";
import { metriquesVides } from "../../engine/jour/index.js";
import { assidu } from "./assidu.js";
import { irregulier } from "./irregulier.js";
import { egoiste } from "./egoiste.js";
import { deserteur } from "./deserteur.js";

let config: Balance;

beforeAll(() => {
  config = chargerConfig("./config/balance.json");
});

function lid(nom: string): LieuId {
  return nom as LieuId;
}
function aid(nom: string): AbordId {
  return nom as AbordId;
}
function jid(nom: string): JoueurId {
  return nom as JoueurId;
}
function abord(nom: string, fortification: number, index = 0): Abord {
  return { id: aid(nom), index_anneau: index, fortification };
}
function lieu(
  nom: string,
  nature: NatureLieu = "feu_de_guet",
  tenu: "royaume" | "horde" | "detruit" = "royaume",
  abords: Abord[] = [abord(`a-${nom}`, 0)],
): Lieu {
  return { id: lid(nom), nature, terrain: "plaine", secteur_id: null, abords, tenu_par: tenu };
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
    fosses: [],
  };
}

function etatMinimal(joueursSpec: Array<[string, EtatJoueur["grade"]]>): {
  etat: EtatCampagne;
  mes_joueurs: JoueurId[];
} {
  const l1 = lieu("entree", "feu_de_guet");
  const pf = lieu("pf", "place_forte", "royaume", [abord("pf-a", 3), abord("pf-b", 3)]);
  const h1 = lieu("h1", "fosse", "horde");
  const prov = province(
    [l1, pf, h1],
    [
      { a: lid("l1"), b: lid("pf"), nature: "route" as const },
      { a: lid("entree"), b: lid("pf"), nature: "route" as const },
      { a: lid("entree"), b: lid("h1"), nature: "route" as const },
    ],
    ["entree"],
    "entree",
    "pf",
  );
  const joueurs = new Map<JoueurId, EtatJoueur>();
  for (const [nom, grade] of joueursSpec) {
    joueurs.set(jid(nom), {
      id: jid(nom),
      grade,
      usure_restante: 12,
      blessure: null,
      transit: null,
    });
  }
  const garnisons = new Map<LieuId, Garnison>();
  for (const l of prov.lieux) garnisons.set(l.id, { lieu_id: l.id, paquets: [], reserve: [] });
  const etat: EtatCampagne = {
    jour: 0,
    graine_lune: 42n,
    province: prov,
    garnisons,
    vivres: new Map(),
    joueurs,
    puissance_varhal: 1,
    doctrines_actives: ["marteau", "ecorcheurs", "rouleau"],
    metriques: metriquesVides(),
  };
  return { etat, mes_joueurs: joueursSpec.map(([n]) => jid(n)) };
}

describe("assidu", () => {
  it("affecte au moins un joueur sur un abord exposé", () => {
    const { etat, mes_joueurs } = etatMinimal([
      ["j1", "sergent"],
      ["j2", "caporal"],
    ]);
    const ordres = assidu({ etat, mes_joueurs, jour: 1, config });
    const affecte = [...ordres.values()].filter((o) => o.type === "affecter");
    expect(affecte.length).toBeGreaterThanOrEqual(1);
  });

  it("réserve au moins un joueur si la part_reserve_max le permet", () => {
    const spec: Array<[string, EtatJoueur["grade"]]> = [];
    for (let i = 0; i < 10; i++) spec.push([`j${i}`, "recrue"]);
    const { etat, mes_joueurs } = etatMinimal(spec);
    const ordres = assidu({ etat, mes_joueurs, jour: 1, config });
    const reserve = [...ordres.values()].filter((o) => o.type === "reserve");
    expect(reserve.length).toBeGreaterThanOrEqual(1);
  });
});

describe("irregulier", () => {
  it("aucun_ordre les jours multiples de 3", () => {
    const { etat, mes_joueurs } = etatMinimal([["j1", "sergent"]]);
    const ordres = irregulier({ etat, mes_joueurs, jour: 3, config });
    expect([...ordres.values()][0]?.type).toBe("aucun_ordre");
  });
  it("assidu les autres jours", () => {
    const { etat, mes_joueurs } = etatMinimal([["j1", "sergent"]]);
    const ordres = irregulier({ etat, mes_joueurs, jour: 2, config });
    expect([...ordres.values()][0]?.type).not.toBe("aucun_ordre");
  });
});

describe("egoiste", () => {
  it("n'affecte jamais un joueur hors de la place forte", () => {
    const { etat, mes_joueurs } = etatMinimal([
      ["j1", "sergent"],
      ["j2", "capitaine"],
    ]);
    const ordres = egoiste({ etat, mes_joueurs, jour: 1, config });
    for (const o of ordres.values()) {
      if (o.type === "affecter" || o.type === "reserve") {
        expect(o.lieu_id).toBe(lid("pf"));
      }
    }
  });
});

describe("deserteur", () => {
  it("assidu jusqu'à J7 inclus", () => {
    const { etat, mes_joueurs } = etatMinimal([["j1", "sergent"]]);
    const ordres = deserteur({ etat, mes_joueurs, jour: 7, config });
    expect([...ordres.values()][0]?.type).not.toBe("aucun_ordre");
  });
  it("aucun_ordre à partir de J8", () => {
    const { etat, mes_joueurs } = etatMinimal([["j1", "sergent"]]);
    const ordres = deserteur({ etat, mes_joueurs, jour: 8, config });
    expect([...ordres.values()][0]?.type).toBe("aucun_ordre");
  });
});
