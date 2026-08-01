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

describe("executerCampagne — assidus purs", () => {
  it("baseline : la province doit tenir 30 jours", () => {
    const res = executerCampagne({
      graine: 7n,
      population: ASSIDUS_PURS,
      puissance_varhal: 1,
      duree_jours: 30,
      config,
    });
    expect(res.province_est_tombee).toBe(false);
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
