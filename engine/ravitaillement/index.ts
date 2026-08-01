// Ravitaillement — deux fonctions pures et distinctes.
// Voir RULES §4. Aucune notion de temps absolu : `appliquerJour` est un pas.

import type { Balance } from "../../config/schema.js";
import type { Lieu, LieuId, Lien, NatureLieu } from "../types/carte.js";

// --- 1. Approvisionnement --------------------------------------------------

export interface ResultatApprovisionnement {
  /** Ensemble des lieux royaume atteignables depuis la place forte par routes tenues. */
  readonly approvisionnes: ReadonlySet<LieuId>;
  /** Taux de recharge journalier effectif pour chaque lieu approvisionné (jours/jour). */
  readonly recharge: ReadonlyMap<LieuId, number>;
}

/**
 * BFS depuis la place forte, ne traversant que les ROUTES entre lieux tenus
 * par le royaume. Un lieu horde ou détruit brise la chaîne.
 *
 * Le taux de recharge de base vient de `config.ravitaillement.recharge_par_jour`.
 * Sur un lieu de terrain marais, il est multiplié par `terrain.marais.recharge`
 * (0.5 par défaut).
 *
 * Si la place forte elle-même n'est pas royaume, personne n'est approvisionné.
 */
export function calculerApprovisionnement(
  lieux: readonly Lieu[],
  liens: readonly Lien[],
  place_forte: LieuId,
  config: Balance,
): ResultatApprovisionnement {
  const lieuxParId = new Map<LieuId, Lieu>();
  for (const l of lieux) lieuxParId.set(l.id, l);

  const pf = lieuxParId.get(place_forte);
  if (pf === undefined || pf.tenu_par !== "royaume") {
    return { approvisionnes: new Set(), recharge: new Map() };
  }

  const voisins = new Map<LieuId, LieuId[]>();
  for (const l of lieux) {
    if (l.tenu_par === "royaume") voisins.set(l.id, []);
  }
  for (const lien of liens) {
    if (lien.nature !== "route") continue;
    const a = lieuxParId.get(lien.a);
    const b = lieuxParId.get(lien.b);
    if (a === undefined || b === undefined) continue;
    if (a.tenu_par !== "royaume" || b.tenu_par !== "royaume") continue;
    voisins.get(lien.a)!.push(lien.b);
    voisins.get(lien.b)!.push(lien.a);
  }

  const approvisionnes = new Set<LieuId>([place_forte]);
  const file: LieuId[] = [place_forte];
  let head = 0;
  while (head < file.length) {
    const cur = file[head++]!;
    for (const v of voisins.get(cur) ?? []) {
      if (!approvisionnes.has(v)) {
        approvisionnes.add(v);
        file.push(v);
      }
    }
  }

  const recharge = new Map<LieuId, number>();
  const base = config.ravitaillement.recharge_par_jour;
  const maraisCoef = config.terrain.marais?.recharge ?? 1;
  for (const id of approvisionnes) {
    const l = lieuxParId.get(id)!;
    const coef = l.terrain === "marais" ? maraisCoef : 1;
    recharge.set(id, base * coef);
  }

  return { approvisionnes, recharge };
}

// --- 2. Application d'un pas de jour ---------------------------------------

export interface EntreeJour {
  readonly vivres_par_lieu: ReadonlyMap<LieuId, number>;
  readonly approvisionnes: ReadonlySet<LieuId>;
  readonly recharge: ReadonlyMap<LieuId, number>;
  readonly assauts_du_jour: ReadonlySet<LieuId>;
  /** Nature de chaque lieu — nécessaire pour la capacité maximale. */
  readonly natures: ReadonlyMap<LieuId, NatureLieu>;
  /** Effectif de garnison par lieu. 0 (ou absent) = pas de consommation. */
  readonly garnisons_effectif: ReadonlyMap<LieuId, number>;
  readonly config: Balance;
}

export interface SortieJour {
  /** Vivres restants par lieu, après consommation et recharge, plafonnés. */
  readonly vivres: ReadonlyMap<LieuId, number>;
  /**
   * Coefficient d'efficacité de la garnison lié au ravitaillement, à
   * appliquer à la force effective en combat. 1.0 quand vivres ≥ seuil,
   * `garnison_affamee` (0.6) quand vivres ≤ 0, linéaire entre les deux.
   */
  readonly coef_ravitaillement: ReadonlyMap<LieuId, number>;
}

/**
 * Un pas de temps sur le ravitaillement. Pur — ne dépend pas de la date
 * absolue, seulement de l'état passé en entrée.
 *
 * Règles (RULES §4) :
 * - Consommation : 1 jour par jour civil si le lieu est tenu (garnison > 0).
 * - +1 supplémentaire si un assaut a eu lieu ce jour-là sur ce lieu.
 * - 0 consommation si vide (garnison nulle).
 * - Recharge : +`recharge[lieu]` jours si le lieu est approvisionné, sinon 0.
 * - Plafond : la capacité selon la nature du lieu.
 * - Plancher : 0 (les vivres ne peuvent pas être négatifs).
 */
export function appliquerJour(entree: EntreeJour): SortieJour {
  const vivres = new Map<LieuId, number>();
  const coef = new Map<LieuId, number>();

  const capMap = entree.config.ravitaillement.capacite_max;
  const consoBase = entree.config.ravitaillement.consommation_par_jour;
  const consoAssaut = entree.config.ravitaillement.consommation_assaut;

  for (const [id, v] of entree.vivres_par_lieu) {
    const nature = entree.natures.get(id);
    if (nature === undefined) continue;
    const cap = capaciteNature(nature, capMap);
    if (cap === null) continue;

    const garnison = entree.garnisons_effectif.get(id) ?? 0;
    const vide = garnison <= 0;

    let conso = 0;
    if (!vide) {
      conso = consoBase;
      if (entree.assauts_du_jour.has(id)) conso += consoAssaut;
    }

    const ajout = entree.approvisionnes.has(id) ? (entree.recharge.get(id) ?? 0) : 0;

    let nouveau = v - conso + ajout;
    if (nouveau < 0) nouveau = 0;
    if (nouveau > cap) nouveau = cap;

    vivres.set(id, nouveau);
    coef.set(id, coefAffamee(nouveau, entree.config));
  }

  return { vivres, coef_ravitaillement: coef };
}

// --- 3. Coefficient de garnison affamée ------------------------------------

/**
 * Coefficient affamée progressif. Pur, sans état.
 *
 * - `vivres_restants >= seuil` → 1.0
 * - `vivres_restants = 0`       → `garnison_affamee` (0.6 par défaut)
 * - Linéaire entre les deux, avec `garnison_affamee` comme plancher pour
 *   toute valeur négative.
 */
export function coefAffamee(vivres_restants: number, config: Balance): number {
  const seuil = config.ravitaillement.seuil_affamee_jours;
  const facteur = config.combat.modificateurs.garnison_affamee;
  if (seuil <= 0) return 1;
  const ratio = Math.min(1, Math.max(0, (seuil - vivres_restants) / seuil));
  return 1 - (1 - facteur) * ratio;
}

// --- Helpers internes ------------------------------------------------------

function capaciteNature(
  nature: NatureLieu,
  capMap: Balance["ravitaillement"]["capacite_max"],
): number | null {
  switch (nature) {
    case "place_forte":
      return capMap.place_forte;
    case "feu_de_guet":
      return capMap.feu_de_guet;
    case "poste_avance":
      return capMap.poste_avance;
    case "fosse":
      return null;
  }
}
