import { describe, it, expect, beforeAll } from "vitest";
import { chargerConfig } from "../../config/loader.js";
import type { Balance } from "../../config/schema.js";
import { genererCarte, type SortieGeneration } from "./generation.js";
import type { LieuId, Province, ProvinceId } from "../types/carte.js";
import { detecterGoulots } from "./goulots.js";

let config: Balance;

beforeAll(() => {
  config = chargerConfig("./config/balance.json");
});

interface OptsGen {
  graine?: bigint;
  effectif_actif?: number;
  province_id?: string;
  province_perdue_id?: string | null;
  configOverride?: Balance;
}

function generer(opts: OptsGen = {}): SortieGeneration {
  return genererCarte({
    graine: opts.graine ?? 42n,
    effectif_actif: opts.effectif_actif ?? 25,
    province_id: (opts.province_id ?? "prov-test") as ProvinceId,
    province_perdue_id:
      opts.province_perdue_id === undefined
        ? null
        : opts.province_perdue_id === null
          ? null
          : (opts.province_perdue_id as ProvinceId),
    config: opts.configOverride ?? config,
  });
}

function bfsRoutes(source: LieuId, p: Province): Map<LieuId, number> {
  const voisins = new Map<LieuId, LieuId[]>();
  for (const l of p.lieux) voisins.set(l.id, []);
  for (const lien of p.liens) {
    if (lien.nature !== "route") continue;
    voisins.get(lien.a)!.push(lien.b);
    voisins.get(lien.b)!.push(lien.a);
  }
  const dist = new Map<LieuId, number>([[source, 0]]);
  const file = [source];
  let head = 0;
  while (head < file.length) {
    const cur = file[head++]!;
    const d = dist.get(cur)!;
    for (const v of voisins.get(cur) ?? []) {
      if (!dist.has(v)) {
        dist.set(v, d + 1);
        file.push(v);
      }
    }
  }
  return dist;
}

function bornesGoulots(N: number, cfg: Balance): { min: number; max: number } {
  const min = Math.max(0, Math.round(N * cfg.carte.goulots_coef_min));
  let max = Math.round(N * cfg.carte.goulots_coef_max);
  if (max - min < cfg.carte.goulots_fenetre_min) max = min + cfg.carte.goulots_fenetre_min;
  return { min, max };
}

describe("generation — déterminisme", () => {
  it("même graine + mêmes paramètres → même sortie", () => {
    const a = generer();
    const b = generer();
    expect(a).toEqual(b);
  });

  it("graines différentes → sorties différentes", () => {
    const a = generer({ graine: 42n });
    const b = generer({ graine: 43n });
    expect(a).not.toEqual(b);
  });
});

describe("generation — invariants topologiques", () => {
  it("il y a au moins N-1 routes, et les routes sont toutes entre lieux royaume", () => {
    const s = generer();
    const routes = s.province.liens.filter((l) => l.nature === "route");
    const royaume = s.province.lieux.filter((l) => l.tenu_par === "royaume");
    // >= N-1 (arbre couvrant + routes redondantes possibles)
    expect(routes.length).toBeGreaterThanOrEqual(royaume.length - 1);
    const royaumeIds = new Set(royaume.map((l) => l.id));
    for (const r of routes) {
      expect(royaumeIds.has(r.a)).toBe(true);
      expect(royaumeIds.has(r.b)).toBe(true);
    }
  });

  it("tout lieu royaume est approvisionnable (BFS routes-only depuis PF)", () => {
    const s = generer();
    const dist = bfsRoutes(s.province.place_forte_id, s.province);
    for (const l of s.province.lieux) {
      if (l.tenu_par !== "royaume") continue;
      expect(dist.has(l.id)).toBe(true);
    }
  });

  it("profondeur entrée → PF ≤ D_max", () => {
    const s = generer();
    const dist = bfsRoutes(s.province.place_forte_id, s.province);
    const dMax = config.carte.profondeur_entree_place_forte_max;
    for (const e of s.province.entrees) {
      const d = dist.get(e);
      expect(d).toBeDefined();
      expect(d!).toBeLessThanOrEqual(dMax);
    }
  });

  it("nombre de goulots sous le plafond (fenêtre dérivée des coefs)", () => {
    const s = generer();
    const royaume = s.province.lieux.filter((l) => l.tenu_par === "royaume").length;
    const { max } = bornesGoulots(royaume, config);
    // On peut avoir moins que le min (accepté par construction : on n'ajoute
    // pas de goulots artificiels). Mais on ne dépasse jamais le plafond.
    expect(s.goulots.length).toBeLessThanOrEqual(max);
  });

  it("natures et nombre d'abords conformes", () => {
    const s = generer();
    let nbPF = 0;
    for (const l of s.province.lieux) {
      switch (l.nature) {
        case "place_forte":
          nbPF++;
          expect(l.abords.length).toBeGreaterThanOrEqual(config.combat.abords_place_forte_min);
          expect(l.abords.length).toBeLessThanOrEqual(config.combat.abords_place_forte_max);
          expect(l.tenu_par).toBe("royaume");
          break;
        case "feu_de_guet":
          expect(l.abords.length).toBe(config.carte.abords.feu_de_guet);
          expect(l.tenu_par).toBe("royaume");
          break;
        case "poste_avance":
          expect(l.abords.length).toBe(config.carte.abords.poste_avance);
          expect(l.tenu_par).toBe("royaume");
          break;
        case "fosse":
          expect(l.abords.length).toBe(config.carte.abords.fosse);
          expect(l.tenu_par).toBe("horde");
          break;
      }
    }
    expect(nbPF).toBe(1);
  });

  it("les fosses ne sont reliées que par des SENTIERS", () => {
    const s = generer();
    const fosseIds = new Set(s.province.fosses);
    for (const l of s.province.liens) {
      if (fosseIds.has(l.a) || fosseIds.has(l.b)) {
        expect(l.nature).toBe("sentier");
      }
    }
  });
});

describe("generation — routes redondantes", () => {
  it("greedy fait descendre les goulots dans la fenêtre quand l'initial dépasse", () => {
    // À grande N (25 royaume), le tree seul produit souvent > goulots_max.
    // Vérifier que le résultat final est ≤ goulots_max.
    const s = generer({ effectif_actif: 100 });
    const royaume = s.province.lieux.filter((l) => l.tenu_par === "royaume").length;
    const { max } = bornesGoulots(royaume, config);
    expect(s.goulots.length).toBeLessThanOrEqual(max);
  });

  it("les routes redondantes sont enregistrées dans le diagnostic", () => {
    // Sur un échantillon de graines, on doit voir au moins UNE carte avec
    // nb_routes_redondantes > 0.
    let aAuMoinsUne = false;
    for (let g = 1n; g <= 30n && !aAuMoinsUne; g++) {
      const s = generer({ graine: g, effectif_actif: 100 });
      const retenu = s.diagnostic[s.diagnostic.length - 1]!;
      if ((retenu.nb_routes_redondantes ?? 0) > 0) aAuMoinsUne = true;
    }
    expect(aAuMoinsUne).toBe(true);
  });

  it("la détection des goulots est cohérente entre le retour et un re-calcul externe", () => {
    const s = generer();
    const royaumeIds = new Set(
      s.province.lieux.filter((l) => l.tenu_par === "royaume").map((l) => l.id),
    );
    const recalcul = detecterGoulots(royaumeIds, s.province.liens, s.province.place_forte_id);
    expect([...s.goulots].sort()).toEqual([...recalcul].sort());
  });
});

describe("generation — dimensionnement", () => {
  it("N compte les lieux royaume UNIQUEMENT, les fosses s'ajoutent par-dessus", () => {
    for (const pop of [2, 5, 15]) {
      const s = generer({ effectif_actif: pop });
      const royaume = s.province.lieux.filter((l) => l.tenu_par === "royaume").length;
      const fosses = s.province.lieux.filter((l) => l.tenu_par === "horde").length;
      const nAttendu = Math.max(
        config.carte.lieux_min,
        Math.min(config.carte.lieux_max, Math.round(pop * config.carte.lieux_par_joueur_actif)),
      );
      expect(royaume).toBe(nAttendu);
      expect(fosses).toBeGreaterThanOrEqual(config.generation.fosses_min);
      expect(fosses).toBeLessThanOrEqual(config.generation.fosses_max);
      expect(s.province.lieux.length).toBe(royaume + fosses);
    }
  });

  it("dimensionnement à 2, 5, 15, 40, 60, 200 joueurs", () => {
    const cas: [number, number][] = [
      [2, 3],
      [5, 3],
      [15, 5],
      [40, 13],
      [60, 20],
      [200, 25],
    ];
    for (const [pop, attendu] of cas) {
      const s = generer({ effectif_actif: pop });
      const royaume = s.province.lieux.filter((l) => l.tenu_par === "royaume").length;
      expect(royaume, `pop=${pop}`).toBe(attendu);
    }
  });
});

describe("generation — invariants divers", () => {
  it("tous les IDs de lieu et d'abord sont uniques", () => {
    const s = generer();
    const lieuIds = s.province.lieux.map((l) => l.id);
    expect(new Set(lieuIds).size).toBe(lieuIds.length);
    const abordIds = s.province.lieux.flatMap((l) => l.abords.map((a) => a.id));
    expect(new Set(abordIds).size).toBe(abordIds.length);
  });

  it("entree_principale ∈ entrees", () => {
    const s = generer();
    expect(s.province.entrees).toContain(s.province.entree_principale);
  });

  it("entree_principale est stable pour un même province_perdue_id", () => {
    const a = generer({ province_perdue_id: "prov-A" });
    const b = generer({ province_perdue_id: "prov-A" });
    expect(a.province.entree_principale).toBe(b.province.entree_principale);
  });

  it("aucune arête n'est une boucle et aucun doublon", () => {
    const s = generer();
    const paires = new Set<string>();
    for (const l of s.province.liens) {
      expect(l.a).not.toBe(l.b);
      const cle = l.a < l.b ? `${l.a}|${l.b}` : `${l.b}|${l.a}`;
      expect(paires.has(cle)).toBe(false);
      paires.add(cle);
    }
  });

  it("le graphe complet (routes + sentiers) est connexe sur tous les lieux", () => {
    const s = generer();
    const voisins = new Map<LieuId, LieuId[]>();
    for (const l of s.province.lieux) voisins.set(l.id, []);
    for (const lien of s.province.liens) {
      voisins.get(lien.a)!.push(lien.b);
      voisins.get(lien.b)!.push(lien.a);
    }
    const vus = new Set<LieuId>([s.province.place_forte_id]);
    const file = [s.province.place_forte_id];
    let head = 0;
    while (head < file.length) {
      const cur = file[head++]!;
      for (const v of voisins.get(cur) ?? []) {
        if (!vus.has(v)) {
          vus.add(v);
          file.push(v);
        }
      }
    }
    expect(vus.size).toBe(s.province.lieux.length);
  });

  it("aucun relâchement pour un config normal", () => {
    for (let g = 1n; g <= 30n; g++) {
      const s = generer({ graine: g, effectif_actif: 100 });
      expect(s.niveau_relaxation).toBe(0);
    }
  });
});
