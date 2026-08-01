// Tests de la campagne complète — snapshot de RapportCampagne à graine fixe.

import { describe, it, expect, beforeAll } from "vitest";
import { chargerConfig } from "../config/loader.js";
import type { Balance } from "../config/schema.js";
import { executerCampagne } from "./campagne.js";
import { synthetiser } from "./rapport.js";
import { MELANGE_REPRESENTATIF, ASSIDUS_PURS } from "./populations/index.js";

let config: Balance;

beforeAll(() => {
  config = chargerConfig("./config/balance.json");
});

describe("executerCampagne — mélange représentatif", () => {
  it("30 jours, graine 42, snapshot stable", () => {
    const res = executerCampagne({
      graine: 42n,
      population: MELANGE_REPRESENTATIF,
      puissance_varhal: 1,
      duree_jours: 30,
      config,
    });
    const rapport = synthetiser(res);
    // Le snapshot capte la totalité du rapport — si un chiffre change, on veut le savoir.
    expect(rapport).toMatchSnapshot();
  });
});

describe("executerCampagne — assidus purs, baseline STATISTIQUE", () => {
  it("sur 20 graines, ≥ 60 % (12/20) doivent tenir 30 jours", () => {
    let tenues = 0;
    let tombees = 0;
    for (let g = 0n; g < 20n; g++) {
      const res = executerCampagne({
        graine: g,
        population: ASSIDUS_PURS,
        puissance_varhal: 1,
        duree_jours: 30,
        config,
      });
      if (res.province_est_tombee) tombees++;
      else tenues++;
    }
    // Une simulation ne se teste pas sur une graine.
    expect(tenues).toBeGreaterThanOrEqual(12);
    // Rapporte les chiffres bruts en cas d'échec pour aider au calibrage.
    if (tenues < 12) {
      throw new Error(`assidus_purs : ${tenues}/20 tenues (${tombees} tombées). Cible ≥ 12/20.`);
    }
  });
});

describe("executerCampagne : reproductibilité", () => {
  it("même graine → même rapport", () => {
    const a = executerCampagne({
      graine: 123n,
      population: MELANGE_REPRESENTATIF,
      puissance_varhal: 1,
      duree_jours: 10,
      config,
    });
    const b = executerCampagne({
      graine: 123n,
      population: MELANGE_REPRESENTATIF,
      puissance_varhal: 1,
      duree_jours: 10,
      config,
    });
    expect(synthetiser(a)).toEqual(synthetiser(b));
  });
});
