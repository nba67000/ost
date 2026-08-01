// Tests unitaires de engine/jour — un pas isolé, cas dégénérés + cas nominal.

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
  TerrainId,
} from "../types/carte.js";
import type { Garnison, JoueurId } from "../types/garnison.js";
import type { EtatCampagne, EtatJoueur, OrdreJoueur } from "../types/campagne.js";
import { avancerJour, metriquesVides } from "./index.js";
import { voisinsAnneau } from "./adapter.js";
import { appliquerOrdres } from "./ordres.js";

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
  terrain: TerrainId = "plaine",
  tenu: "royaume" | "horde" | "detruit" = "royaume",
  abords: Abord[] = [abord(`a-${nom}`, 0)],
): Lieu {
  return { id: lid(nom), nature, terrain, secteur_id: null, abords, tenu_par: tenu };
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

describe("voisinsAnneau", () => {
  it("un seul abord : aucun voisin", () => {
    const m = voisinsAnneau([abord("a", 0, 0)]);
    expect(m.get(aid("a"))).toEqual([]);
  });
  it("deux abords : un voisin réciproque", () => {
    const m = voisinsAnneau([abord("a", 0, 0), abord("b", 0, 1)]);
    expect(m.get(aid("a"))).toEqual([aid("b")]);
    expect(m.get(aid("b"))).toEqual([aid("a")]);
  });
  it("trois abords : chaque abord a deux voisins", () => {
    const m = voisinsAnneau([abord("a", 0, 0), abord("b", 0, 1), abord("c", 0, 2)]);
    expect(m.get(aid("a"))?.length).toBe(2);
  });
});

describe("appliquerOrdres", () => {
  it("un ordre `affecter` place le joueur au bon paquet", () => {
    const l = lieu("l", "feu_de_guet");
    const prov = province([l], [], [], "l", "l");
    const joueurs = new Map<JoueurId, EtatJoueur>([
      [jid("j1"), { id: jid("j1"), grade: "sergent", usure_restante: 12, blessure: null }],
    ]);
    const garnisonsPrec = new Map<LieuId, Garnison>([
      [lid("l"), { lieu_id: lid("l"), paquets: [], reserve: [] }],
    ]);
    const ordres = new Map<JoueurId, OrdreJoueur>([
      [jid("j1"), { type: "affecter", lieu_id: lid("l"), abord_id: aid("a-l"), posture: "mur" }],
    ]);
    const res = appliquerOrdres(
      garnisonsPrec,
      ordres,
      joueurs,
      prov.lieux.map((x) => x.id),
      config,
      5,
    );
    const g = res.get(lid("l"))!;
    expect(g.paquets).toHaveLength(1);
    expect(g.paquets[0]?.joueurs).toEqual([jid("j1")]);
    expect(g.paquets[0]?.effectif).toBe(config.grades.effectif_commande.sergent);
  });

  it("un ordre `aucun_ordre` laisse le joueur là où il était", () => {
    const l = lieu("l", "feu_de_guet");
    const prov = province([l], [], [], "l", "l");
    const joueurs = new Map<JoueurId, EtatJoueur>([
      [jid("j1"), { id: jid("j1"), grade: "sergent", usure_restante: 12, blessure: null }],
    ]);
    const garnisonsPrec = new Map<LieuId, Garnison>([
      [
        lid("l"),
        {
          lieu_id: lid("l"),
          paquets: [{ abord_id: aid("a-l"), joueurs: [jid("j1")], effectif: 15, posture: "mur" }],
          reserve: [],
        },
      ],
    ]);
    const ordres = new Map<JoueurId, OrdreJoueur>([[jid("j1"), { type: "aucun_ordre" }]]);
    const res = appliquerOrdres(
      garnisonsPrec,
      ordres,
      joueurs,
      prov.lieux.map((x) => x.id),
      config,
      5,
    );
    expect(res.get(lid("l"))?.paquets[0]?.joueurs).toEqual([jid("j1")]);
  });

  it("un ordre sur un joueur INAPTE au combat est ignoré", () => {
    const l = lieu("l");
    const prov = province([l], [], [], "l", "l");
    const joueurs = new Map<JoueurId, EtatJoueur>([
      [
        jid("j1"),
        {
          id: jid("j1"),
          grade: "sergent",
          usure_restante: 12,
          blessure: {
            severite: "grave",
            retour_combat_jour: 100,
            fin_presence_centre_jour: 100,
          },
        },
      ],
    ]);
    const garnisonsPrec = new Map<LieuId, Garnison>([
      [lid("l"), { lieu_id: lid("l"), paquets: [], reserve: [] }],
    ]);
    const ordres = new Map<JoueurId, OrdreJoueur>([
      [jid("j1"), { type: "affecter", lieu_id: lid("l"), abord_id: aid("a-l"), posture: "mur" }],
    ]);
    const res = appliquerOrdres(
      garnisonsPrec,
      ordres,
      joueurs,
      prov.lieux.map((x) => x.id),
      config,
      5,
    );
    expect(res.get(lid("l"))?.paquets).toHaveLength(0);
  });

  it("un ordre sur un joueur apte au combat mais encore au centre est accepté", () => {
    const l = lieu("l");
    const prov = province([l], [], [], "l", "l");
    const joueurs = new Map<JoueurId, EtatJoueur>([
      [
        jid("j1"),
        {
          id: jid("j1"),
          grade: "sergent",
          usure_restante: 12,
          // Apte au combat depuis J3, encore inscrit au centre jusqu'à J6.
          blessure: {
            severite: "legere",
            retour_combat_jour: 3,
            fin_presence_centre_jour: 6,
          },
        },
      ],
    ]);
    const garnisonsPrec = new Map<LieuId, Garnison>([
      [lid("l"), { lieu_id: lid("l"), paquets: [], reserve: [] }],
    ]);
    const ordres = new Map<JoueurId, OrdreJoueur>([
      [jid("j1"), { type: "affecter", lieu_id: lid("l"), abord_id: aid("a-l"), posture: "mur" }],
    ]);
    const res = appliquerOrdres(
      garnisonsPrec,
      ordres,
      joueurs,
      prov.lieux.map((x) => x.id),
      config,
      5,
    );
    expect(res.get(lid("l"))?.paquets[0]?.joueurs).toEqual([jid("j1")]);
  });
});

describe("avancerJour : cas dégénéré aucun exposé", () => {
  it("province close, aucun assaut, jour + 1, aucune blessure", () => {
    const pf = lieu("pf", "place_forte", "plaine", "royaume", [abord("pf-a", 3)]);
    const prov = province([pf], [], [], "pf", "pf");
    const joueurs = new Map<JoueurId, EtatJoueur>([
      [jid("j1"), { id: jid("j1"), grade: "general", usure_restante: 12, blessure: null }],
    ]);
    const garnisons = new Map<LieuId, Garnison>([
      [
        lid("pf"),
        {
          lieu_id: lid("pf"),
          paquets: [{ abord_id: aid("pf-a"), joueurs: [jid("j1")], effectif: 50, posture: "mur" }],
          reserve: [],
        },
      ],
    ]);
    const vivres = new Map<LieuId, number>([[lid("pf"), 10]]);
    const etat: EtatCampagne = {
      jour: 0,
      graine_lune: 42n,
      province: prov,
      garnisons,
      vivres,
      joueurs,
      puissance_varhal: 1,
      doctrines_actives: ["marteau", "ecorcheurs", "rouleau"],
      metriques: metriquesVides(),
    };
    const { etat_suivant, rapport } = avancerJour({ etat, ordres: new Map(), config });
    expect(rapport.jour).toBe(1);
    expect(rapport.assauts).toHaveLength(0);
    expect(rapport.blesses_du_jour).toBe(0);
    expect(etat_suivant.metriques.jour_chute).toBeNull();
  });
});

describe("avancerJour : déterminisme", () => {
  it("même entrée → même sortie, deux fois de suite", () => {
    const pf = lieu("pf", "place_forte", "plaine", "royaume", [abord("pf-a", 3)]);
    const prov = province([pf], [], [], "pf", "pf");
    const joueurs = new Map<JoueurId, EtatJoueur>([
      [jid("j1"), { id: jid("j1"), grade: "general", usure_restante: 12, blessure: null }],
    ]);
    const garnisons = new Map<LieuId, Garnison>([
      [
        lid("pf"),
        {
          lieu_id: lid("pf"),
          paquets: [{ abord_id: aid("pf-a"), joueurs: [jid("j1")], effectif: 50, posture: "mur" }],
          reserve: [],
        },
      ],
    ]);
    const etat: EtatCampagne = {
      jour: 0,
      graine_lune: 42n,
      province: prov,
      garnisons,
      vivres: new Map([[lid("pf"), 10]]),
      joueurs,
      puissance_varhal: 1,
      doctrines_actives: ["marteau", "ecorcheurs", "rouleau"],
      metriques: metriquesVides(),
    };
    const a = avancerJour({ etat, ordres: new Map(), config });
    const b = avancerJour({ etat, ordres: new Map(), config });
    expect(a.rapport).toEqual(b.rapport);
    expect(a.etat_suivant.metriques).toEqual(b.etat_suivant.metriques);
  });
});
