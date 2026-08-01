import { describe, it, expect, beforeAll } from "vitest";
import { chargerConfig } from "../../config/loader.js";
import type { Balance } from "../../config/schema.js";
import { resoudreAssaut, severite, type EntreeAssaut } from "./assaut.js";
import { type EtatAbord, type EtatRound } from "./round.js";
import type { AbordId, LieuId } from "../types/carte.js";
import type { TypeForge } from "../types/forge.js";
import type { Posture } from "../types/garnison.js";
import type { Grade } from "../types/grade.js";

let config: Balance;

beforeAll(() => {
  config = chargerConfig("./config/balance.json");
});

// --- Helpers -------------------------------------------------------------

function abordId(x: string): AbordId {
  return x as AbordId;
}
function lieuId(x: string): LieuId {
  return x as LieuId;
}

interface AbordOpts {
  id: string;
  effectif?: number;
  effectif_initial_assaut?: number;
  posture?: Exclude<Posture, "reserve">;
  voisins?: string[];
  fortification_niveau?: number;
  terrain_fortification?: number;
  ravitaillement_coef?: number;
  fatigue_coef?: number;
  usure_coef?: number;
  preparation_coef?: number;
  commandant_grade?: Grade;
}

function abord(opts: AbordOpts): EtatAbord {
  const eff = opts.effectif ?? 30;
  return {
    abord_id: abordId(opts.id),
    effectif: eff,
    effectif_initial_assaut: opts.effectif_initial_assaut ?? eff,
    posture: (opts.posture ?? "mur") as Posture,
    voisins: (opts.voisins ?? []).map(abordId),
    fortification_niveau: opts.fortification_niveau ?? 0,
    terrain_fortification: opts.terrain_fortification ?? 1,
    ravitaillement_coef: opts.ravitaillement_coef ?? 1,
    fatigue_coef: opts.fatigue_coef ?? 1,
    usure_coef: opts.usure_coef ?? 1,
    preparation_coef: opts.preparation_coef ?? 1,
    commandant_grade: opts.commandant_grade ?? "sergent",
    rompu: false,
    flanque_ce_round: false,
  };
}

function etatInitial(abords: AbordOpts[], reserve = 0): EtatRound {
  return {
    lieu_id: lieuId("L001"),
    numero_round: 1,
    abords: abords.map(abord),
    reserve: {
      effectif: reserve,
      effectif_initial_assaut: reserve,
      commandant_grade: "sergent",
    },
  };
}

function vague(comp: Partial<Record<TypeForge, number>>): Record<TypeForge, number> {
  return {
    souche: comp.souche ?? 0,
    ecorcheur: comp.ecorcheur ?? 0,
    belier: comp.belier ?? 0,
    chien_de_fosse: comp.chien_de_fosse ?? 0,
    muet: comp.muet ?? 0,
  };
}

function vagues(
  spec: Record<number, Record<string, Partial<Record<TypeForge, number>>>>,
): Map<number, Map<AbordId, Record<TypeForge, number>>> {
  const out = new Map<number, Map<AbordId, Record<TypeForge, number>>>();
  for (const [r, byAbord] of Object.entries(spec)) {
    const m = new Map<AbordId, Record<TypeForge, number>>();
    for (const [id, comp] of Object.entries(byAbord)) {
      m.set(abordId(id), vague(comp));
    }
    out.set(Number(r), m);
  }
  return out;
}

function entree(
  etat_initial: EtatRound,
  vaguesPar: Map<number, Map<AbordId, Record<TypeForge, number>>>,
): EntreeAssaut {
  return { etat_initial, vagues_par_round: vaguesPar, conditions_reserve: [], config };
}

// --- Sévérité ---------------------------------------------------------

describe("severite — bornes exactes (seuils 1.5 / 3.0)", () => {
  it("ratio < 1.5 : légère", () => {
    expect(severite(0, config)).toBe("legere");
    expect(severite(1.0, config)).toBe("legere");
    expect(severite(1.499, config)).toBe("legere");
  });

  it("ratio = 1.5 exact : sérieuse (borne incluse)", () => {
    expect(severite(1.5, config)).toBe("serieuse");
  });

  it("ratio entre 1.5 et 3.0 : sérieuse", () => {
    expect(severite(2, config)).toBe("serieuse");
    expect(severite(2.9, config)).toBe("serieuse");
  });

  it("ratio = 3.0 exact : sérieuse (borne incluse)", () => {
    expect(severite(3.0, config)).toBe("serieuse");
  });

  it("ratio > 3.0 : grave", () => {
    expect(severite(3.001, config)).toBe("grave");
    expect(severite(10, config)).toBe("grave");
    expect(severite(Number.POSITIVE_INFINITY, config)).toBe("grave");
  });
});

// --- Conditions d'arrêt -----------------------------------------------

describe("resoudreAssaut — conditions d'arrêt", () => {
  it("lieu tombe : tous les abords cèdent au round 1", () => {
    const s = resoudreAssaut(
      entree(
        etatInitial([
          { id: "porte", effectif: 2, effectif_initial_assaut: 30 },
          { id: "poterne", effectif: 2, effectif_initial_assaut: 30 },
        ]),
        vagues({
          1: { porte: { souche: 60 }, poterne: { souche: 60 } },
        }),
      ),
    );
    expect(s.issue).toBe("lieu_tombe");
    expect(s.rounds_utilises).toBe(1);
    expect(s.etat_final.abords.every((a) => a.rompu)).toBe(true);
  });

  it("assaut repoussé : aucune vague dans le scénario", () => {
    const s = resoudreAssaut(entree(etatInitial([{ id: "porte", effectif: 30 }]), new Map()));
    expect(s.issue).toBe("assaut_repousse");
    expect(s.rounds_utilises).toBe(0);
    expect(s.rounds.length).toBe(0);
  });

  it("rounds_max atteints : défenseur tient", () => {
    // Effectif défensif fort, attaques faibles à chaque round.
    const vaguesPar = vagues({
      1: { porte: { souche: 1 } },
      2: { porte: { souche: 1 } },
      3: { porte: { souche: 1 } },
      4: { porte: { souche: 1 } },
      5: { porte: { souche: 1 } },
    });
    const s = resoudreAssaut(entree(etatInitial([{ id: "porte", effectif: 100 }]), vaguesPar));
    expect(s.issue).toBe("rounds_max_atteints");
    expect(s.rounds_utilises).toBe(config.combat.rounds_max);
  });
});

// --- Propagation du flanc ----------------------------------------------

describe("resoudreAssaut — propagation du flanc sur 3 rounds", () => {
  it("chaîne A—B—C : A rupt R1, B flanqué + rupt R2, C flanqué R3", () => {
    const s = resoudreAssaut(
      entree(
        etatInitial([
          { id: "A", effectif: 10, effectif_initial_assaut: 40, voisins: ["B"] },
          { id: "B", effectif: 10, effectif_initial_assaut: 40, voisins: ["A", "C"] },
          { id: "C", effectif: 30, effectif_initial_assaut: 30, voisins: ["B"] },
        ]),
        vagues({
          1: { A: { souche: 40 } },
          2: { B: { souche: 40 } },
          3: { C: { souche: 5 } },
        }),
      ),
    );

    expect(s.rounds.length).toBeGreaterThanOrEqual(3);

    const dA_r1 = s.rounds[0]!.details_abords.find((d) => d.abord_id === abordId("A"))!;
    const dB_r1 = s.rounds[0]!.details_abords.find((d) => d.abord_id === abordId("B"))!;
    const dC_r1 = s.rounds[0]!.details_abords.find((d) => d.abord_id === abordId("C"))!;
    expect(dA_r1.rupture).toBe(true);
    expect(dB_r1.flanque_ce_round).toBe(false); // pas d'héritage au round 1
    expect(dC_r1.flanque_ce_round).toBe(false);

    const dB_r2 = s.rounds[1]!.details_abords.find((d) => d.abord_id === abordId("B"))!;
    expect(dB_r2.flanque_ce_round).toBe(true); // hérité de A rompu au R1
    expect(dB_r2.rupture).toBe(true);

    const dC_r3 = s.rounds[2]!.details_abords.find((d) => d.abord_id === abordId("C"))!;
    expect(dC_r3.flanque_ce_round).toBe(true); // hérité de B rompu au R2
  });
});

// --- Blessures ---------------------------------------------------------

describe("resoudreAssaut — blessures", () => {
  it("les blessés ne sortent que des abords ayant CÉDÉ", () => {
    // porte rupt (avec combat), poterne tient (avec combat). Blessures seulement pour porte.
    const s = resoudreAssaut(
      entree(
        etatInitial([
          { id: "porte", effectif: 10, effectif_initial_assaut: 40 },
          { id: "poterne", effectif: 30 },
        ]),
        vagues({ 1: { porte: { souche: 40 }, poterne: { souche: 10 } } }),
      ),
    );
    // porte rompue
    const porteApres = s.etat_final.abords.find((a) => a.abord_id === abordId("porte"))!;
    const poterneApres = s.etat_final.abords.find((a) => a.abord_id === abordId("poterne"))!;
    expect(porteApres.rompu).toBe(true);
    expect(poterneApres.rompu).toBe(false);
    // Toutes les blessures sont depuis porte
    for (const b of s.blessures) expect(b.abord_id).toBe(abordId("porte"));
    expect(s.blessures.length).toBeGreaterThan(0);
  });

  it("un abord cédé sans combat ne produit aucun blessé", () => {
    const s = resoudreAssaut(
      entree(
        etatInitial([
          { id: "porte", effectif: 0, effectif_initial_assaut: 30 },
          { id: "poterne", effectif: 30 },
        ]),
        vagues({ 1: { porte: { souche: 20 } } }),
      ),
    );
    // porte cede_sans_combat
    const dPorte = s.rounds[0]!.details_abords.find((d) => d.abord_id === abordId("porte"))!;
    expect(dPorte.cede_sans_combat).toBe(true);
    expect(s.blessures.filter((b) => b.abord_id === abordId("porte")).length).toBe(0);
  });

  it("nombre de blessés = floor(part_des_pertes × pertes cumulées de cet abord)", () => {
    // Un abord unique ruptured, on somme les pertes journal, on vérifie le compte.
    const s = resoudreAssaut(
      entree(
        etatInitial([{ id: "porte", effectif: 10, effectif_initial_assaut: 40 }]),
        vagues({ 1: { porte: { souche: 40 } } }),
      ),
    );
    let pertes = 0;
    for (const j of s.rounds) {
      const d = j.details_abords.find((x) => x.abord_id === abordId("porte"));
      if (d) pertes += d.pertes_defenseur;
    }
    const attendu = Math.floor(config.blessures.part_des_pertes * pertes);
    expect(s.blessures.length).toBe(attendu);
  });
});

// --- Usure -------------------------------------------------------------

describe("resoudreAssaut — usure", () => {
  it("+1 sur abord rompu, +0 sur abord tenu (avec combat), 0 sans combat", () => {
    const s = resoudreAssaut(
      entree(
        etatInitial([
          { id: "porte", effectif: 10, effectif_initial_assaut: 40 }, // rupt
          { id: "poterne", effectif: 30 }, // tient
          { id: "flanc", effectif: 30 }, // pas d'assaut
        ]),
        vagues({ 1: { porte: { souche: 40 }, poterne: { souche: 20 } } }),
      ),
    );
    const usurePorte = s.usure.find((u) => u.abord_id === abordId("porte"))!;
    const usurePoterne = s.usure.find((u) => u.abord_id === abordId("poterne"))!;
    const usureFlanc = s.usure.find((u) => u.abord_id === abordId("flanc"))!;
    expect(usurePorte.cout).toBe(config.usure.par_assaut + config.usure.penalite_abord_rompu);
    expect(usurePoterne.cout).toBe(config.usure.par_assaut);
    expect(usureFlanc.cout).toBe(0);
  });
});

// --- Déterminisme ------------------------------------------------------

describe("resoudreAssaut — déterminisme", () => {
  it("mêmes entrées, même sortie complète", () => {
    const e = entree(
      etatInitial(
        [
          { id: "porte", effectif: 25, posture: "mur", voisins: ["poterne"] },
          { id: "poterne", effectif: 20, posture: "cognee", voisins: ["porte"] },
        ],
        8,
      ),
      vagues({
        1: { porte: { souche: 15, belier: 5 }, poterne: { ecorcheur: 10 } },
        2: { porte: { souche: 12 } },
      }),
    );
    const s1 = resoudreAssaut(e);
    const s2 = resoudreAssaut(e);
    expect(s1).toEqual(s2);
  });
});
