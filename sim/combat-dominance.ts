// npm run combat:dominance
// Banc : grille (nombre d'abords) × (niveau de fortification).
// Pour chaque cellule, cherche par dichotomie le RATIO DE BASCULE en
// EFFECTIFS BRUTS (attaquant/défenseur) du meilleur défenseur.

import { chargerConfig } from "../config/loader.js";
import type { Balance } from "../config/schema.js";
import { resoudreAssaut, type EntreeAssaut, type SortieAssaut } from "../engine/combat/assaut.js";
import type { EtatAbord, EtatRound } from "../engine/combat/round.js";
import type { AbordId, LieuId } from "../engine/types/carte.js";
import type { TypeForge } from "../engine/types/forge.js";
import type { Posture } from "../engine/types/garnison.js";
import type { ConditionReserve } from "../engine/types/ordre.js";

const TOTAL_GARNISON = 100;
const POSTURES: readonly Exclude<Posture, "reserve">[] = ["cognee", "fer", "mur"];
const TYPES: readonly TypeForge[] = ["souche", "ecorcheur", "belier", "chien_de_fosse", "muet"];

const RATIO_MIN = 0.5;
const RATIO_MAX = 10.0;
const RATIO_PRECISION = 0.05;
const RATIO_SENTINEL = RATIO_MAX + RATIO_PRECISION;

const COMPOSITIONS: readonly {
  readonly composition: Readonly<Record<TypeForge, number>>;
  readonly nom: string;
}[] = [
  {
    composition: { souche: 1, ecorcheur: 0, belier: 0, chien_de_fosse: 0, muet: 0 },
    nom: "souche",
  },
  {
    composition: { souche: 0, ecorcheur: 1, belier: 0, chien_de_fosse: 0, muet: 0 },
    nom: "ecorcheur",
  },
  {
    composition: { souche: 0, ecorcheur: 0, belier: 1, chien_de_fosse: 0, muet: 0 },
    nom: "belier",
  },
  {
    composition: { souche: 0, ecorcheur: 0, belier: 0, chien_de_fosse: 0, muet: 1 },
    nom: "muet",
  },
  {
    composition: { souche: 0.5, ecorcheur: 0, belier: 0.5, chien_de_fosse: 0, muet: 0 },
    nom: "souche+belier",
  },
  {
    composition: { souche: 0.2, ecorcheur: 0.2, belier: 0.2, chien_de_fosse: 0.2, muet: 0.2 },
    nom: "uniforme",
  },
];

interface BenchConfig {
  readonly k: number;
  readonly pasDef: number;
  readonly pasSplit: number;
  readonly nature: string;
  readonly fortifBase: number;
}

const CONFIGS: readonly BenchConfig[] = [
  { k: 1, pasDef: 10, pasSplit: 100, nature: "poste_avancé", fortifBase: 0 },
  { k: 2, pasDef: 10, pasSplit: 10, nature: "feu_de_guet", fortifBase: 1 },
  { k: 3, pasDef: 10, pasSplit: 25, nature: "place_forte (3)", fortifBase: 3 },
  { k: 4, pasDef: 20, pasSplit: 25, nature: "place_forte (4)", fortifBase: 3 },
];

const FORTIF_LEVELS = [0, 1, 2, 3, 4];

// --- Types -----------------------------------------------------------

type PostureOrNone = Exclude<Posture, "reserve"> | "-";

interface DefStrat {
  readonly abords: readonly number[];
  readonly postures: readonly PostureOrNone[];
  readonly r: number;
  readonly label: string;
}

interface AttackShape {
  readonly splits: readonly number[];
  readonly composition: Readonly<Record<TypeForge, number>>;
  readonly nomCompo: string;
  readonly label: string;
}

// --- Canonicalisation ------------------------------------------------

function canonicalKeyDef(
  abords: readonly number[],
  postures: readonly PostureOrNone[],
  r: number,
): string {
  const pairs = abords.map((a, i) => ({ a, p: postures[i]! }));
  pairs.sort((x, y) => {
    if (y.a !== x.a) return y.a - x.a;
    return x.p < y.p ? -1 : x.p > y.p ? 1 : 0;
  });
  return pairs.map((p) => `${p.a}${p.p}`).join(",") + `|r${r}`;
}

function labelDef(
  abords: readonly number[],
  postures: readonly PostureOrNone[],
  r: number,
): string {
  const pairs = abords.map((a, i) => ({ a, p: postures[i]! }));
  pairs.sort((x, y) => {
    if (y.a !== x.a) return y.a - x.a;
    return x.p < y.p ? -1 : x.p > y.p ? 1 : 0;
  });
  const aStr = pairs.map((p) => String(p.a).padStart(3)).join("/");
  const pStr = pairs.map((p) => (p.p === "-" ? "-" : p.p.charAt(0))).join("");
  return `${aStr}-${pStr}|r${String(r).padStart(2)}`;
}

function canonicalKeyShape(splits: readonly number[], nomCompo: string): string {
  const sorted = [...splits].sort((a, b) => b - a);
  return sorted.map((s) => Math.round(s * 100)).join("/") + `|${nomCompo}`;
}

function labelShape(splits: readonly number[], nomCompo: string): string {
  const sorted = [...splits].sort((a, b) => b - a);
  return `${nomCompo.padEnd(13)}-${sorted.map((s) => String(Math.round(s * 100)).padStart(3)).join("/")}`;
}

// --- Énumération -----------------------------------------------------

function enumererDefs(cfg: BenchConfig, balance: Balance): DefStrat[] {
  const rMax = Math.floor(balance.combat.part_reserve_max * TOTAL_GARNISON);
  const seen = new Set<string>();
  const strats: DefStrat[] = [];

  function ajouterAvecPostures(alloc: number[], r: number): void {
    const nonZero: number[] = [];
    for (let i = 0; i < alloc.length; i++) if (alloc[i]! > 0) nonZero.push(i);
    const nz = nonZero.length;
    let total = 1;
    for (let i = 0; i < nz; i++) total *= POSTURES.length;
    for (let mask = 0; mask < total; mask++) {
      const postures: PostureOrNone[] = alloc.map((a) => (a > 0 ? POSTURES[0]! : "-"));
      let m = mask;
      for (const idx of nonZero) {
        postures[idx] = POSTURES[m % POSTURES.length]!;
        m = Math.floor(m / POSTURES.length);
      }
      const key = canonicalKeyDef(alloc, postures, r);
      if (seen.has(key)) continue;
      seen.add(key);
      strats.push({
        abords: alloc.slice(),
        postures: postures.slice(),
        r,
        label: labelDef(alloc, postures, r),
      });
    }
  }

  function recurse(index: number, remaining: number, current: number[]): void {
    if (index === cfg.k) {
      if (remaining < 0 || remaining > rMax) return;
      ajouterAvecPostures(current, remaining);
      return;
    }
    for (let a = 0; a <= Math.min(TOTAL_GARNISON, remaining); a += cfg.pasDef) {
      current.push(a);
      recurse(index + 1, remaining - a, current);
      current.pop();
    }
  }
  recurse(0, TOTAL_GARNISON, []);
  return strats;
}

function enumererShapes(cfg: BenchConfig): AttackShape[] {
  const seen = new Set<string>();
  const shapes: AttackShape[] = [];

  function ajouterAvecCompos(splitsPct: number[]): void {
    const splits = splitsPct.map((s) => s / 100);
    for (const c of COMPOSITIONS) {
      const key = canonicalKeyShape(splits, c.nom);
      if (seen.has(key)) continue;
      seen.add(key);
      shapes.push({
        splits: splits.slice(),
        composition: c.composition,
        nomCompo: c.nom,
        label: labelShape(splits, c.nom),
      });
    }
  }

  function recurse(index: number, remaining: number, current: number[]): void {
    if (index === cfg.k) {
      if (remaining === 0) ajouterAvecCompos(current);
      return;
    }
    for (let s = 0; s <= remaining; s += cfg.pasSplit) {
      current.push(s);
      recurse(index + 1, remaining - s, current);
      current.pop();
    }
  }
  recurse(0, 100, []);
  return shapes;
}

// --- Combat ----------------------------------------------------------

function voisinsAnneau(i: number, k: number): number[] {
  if (k === 1) return [];
  if (k === 2) return [1 - i];
  return [(i - 1 + k) % k, (i + 1) % k];
}

function abordId(i: number): AbordId {
  return `a${i}` as AbordId;
}

function construireVague(
  volume: number,
  split: number,
  composition: Readonly<Record<TypeForge, number>>,
): Record<TypeForge, number> {
  const total = volume * split;
  const out: Record<TypeForge, number> = {
    souche: 0,
    ecorcheur: 0,
    belier: 0,
    chien_de_fosse: 0,
    muet: 0,
  };
  for (const t of TYPES) out[t] = Math.round(total * composition[t]);
  return out;
}

function abord(
  i: number,
  k: number,
  eff: number,
  posture: PostureOrNone,
  fortifNiveau: number,
): EtatAbord {
  const p: Exclude<Posture, "reserve"> = posture === "-" ? "mur" : posture;
  return {
    abord_id: abordId(i),
    effectif: eff,
    effectif_initial_assaut: eff,
    posture: p,
    voisins: voisinsAnneau(i, k).map(abordId),
    fortification_niveau: fortifNiveau,
    terrain_fortification: 1,
    ravitaillement_coef: 1,
    fatigue_coef: 1,
    usure_coef: 1,
    preparation_coef: 1,
    commandant_grade: "sergent",
    rompu: false,
    flanque_ce_round: false,
    reserve_recente: false,
  };
}

function conditionsStandard(k: number): ConditionReserve[] {
  const conds: ConditionReserve[] = [];
  for (let i = 0; i < k; i++) {
    conds.push({
      ordre: i + 1,
      declencheur: {
        abord_id: abordId(i),
        metrique: "effectif_restant_relatif",
        comparateur: "<",
        seuil: 0.5,
      },
      action: { abord_cible: abordId(i), part_reserve: 1.0 },
    });
  }
  return conds;
}

function jouerRatio(
  D: DefStrat,
  A: AttackShape,
  ratio: number,
  fortifNiveau: number,
  balance: Balance,
): SortieAssaut {
  const volume = ratio * TOTAL_GARNISON;
  const k = D.abords.length;
  const abords: EtatAbord[] = D.abords.map((a, i) => abord(i, k, a, D.postures[i]!, fortifNiveau));
  const etat_initial: EtatRound = {
    lieu_id: "L001" as LieuId,
    numero_round: 1,
    abords,
    reserve: { effectif: D.r, effectif_initial_assaut: D.r, commandant_grade: "sergent" },
  };
  const vagues_par_round = new Map<number, Map<AbordId, Record<TypeForge, number>>>();
  for (let r = 1; r <= balance.combat.rounds_max; r++) {
    const m = new Map<AbordId, Record<TypeForge, number>>();
    for (let i = 0; i < k; i++) {
      const s = A.splits[i] ?? 0;
      if (s > 0) m.set(abordId(i), construireVague(volume, s, A.composition));
    }
    vagues_par_round.set(r, m);
  }
  const entree: EntreeAssaut = {
    etat_initial,
    vagues_par_round,
    conditions_reserve: conditionsStandard(k),
    config: balance,
  };
  return resoudreAssaut(entree);
}

function bascule(D: DefStrat, A: AttackShape, fortifNiveau: number, balance: Balance): number {
  const haut = jouerRatio(D, A, RATIO_MAX, fortifNiveau, balance);
  if (haut.issue !== "lieu_tombe") return RATIO_SENTINEL;
  const bas = jouerRatio(D, A, RATIO_MIN, fortifNiveau, balance);
  if (bas.issue === "lieu_tombe") return RATIO_MIN;
  let lo = RATIO_MIN;
  let hi = RATIO_MAX;
  while (hi - lo > RATIO_PRECISION) {
    const mid = (lo + hi) / 2;
    const s = jouerRatio(D, A, mid, fortifNiveau, balance);
    if (s.issue === "lieu_tombe") hi = mid;
    else lo = mid;
  }
  return hi;
}

function median(vals: readonly number[]): number {
  const sorted = [...vals].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  if (n % 2 === 1) return sorted[Math.floor(n / 2)]!;
  return (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

function fmt(r: number): string {
  return r >= RATIO_SENTINEL ? ">10.0" : r.toFixed(2);
}

// --- Cellule : meilleure médiane du top défenseur --------------------

function meilleureMediane(
  fortifNiveau: number,
  balance: Balance,
  defs: readonly DefStrat[],
  shapes: readonly AttackShape[],
): number {
  let best = -Infinity;
  for (const D of defs) {
    const bascules: number[] = [];
    for (const A of shapes) bascules.push(bascule(D, A, fortifNiveau, balance));
    const med = median(bascules);
    if (med > best) best = med;
  }
  return best;
}

// --- Main ------------------------------------------------------------

const config = chargerConfig("./config/balance.json");
process.stdout.write(
  `Ratio de bascule en EFFECTIFS BRUTS. Grille (nb abords × niveau de fortification).\n` +
    `Cellule = médiane de bascule du meilleur défenseur.\n` +
    `combat.fortification_par_niveau = ${config.combat.modificateurs.fortification_par_niveau}.\n\n`,
);

// Précalcul des défs et shapes par config (indépendant du niveau de fortif).
const enums = CONFIGS.map((c) => ({
  cfg: c,
  defs: enumererDefs(c, config),
  shapes: enumererShapes(c),
}));
for (const e of enums) {
  process.stdout.write(
    `${e.cfg.nature.padEnd(20)} (k=${e.cfg.k}) : ${e.defs.length} défs × ${e.shapes.length} shapes\n`,
  );
}
process.stdout.write("\n");

const t0 = Date.now();
const grid: number[][] = [];
for (const e of enums) {
  const row: number[] = [];
  for (const fortif of FORTIF_LEVELS) {
    const med = meilleureMediane(fortif, config, e.defs, e.shapes);
    row.push(med);
  }
  grid.push(row);
}
process.stdout.write(`Grille calculée en ${((Date.now() - t0) / 1000).toFixed(1)}s.\n\n`);

// Affichage grille
const header = "Nature                 fortif=0  fortif=1  fortif=2  fortif=3  fortif=4";
process.stdout.write(header + "\n");
process.stdout.write("-".repeat(header.length) + "\n");
for (let i = 0; i < enums.length; i++) {
  const label = enums[i]!.cfg.nature.padEnd(22);
  const row = grid[i]!.map((v) => fmt(v).padStart(8)).join("  ");
  process.stdout.write(`${label} ${row}\n`);
}

// Cellule de base par nature
process.stdout.write("\nÀ la fortification de BASE de chaque nature :\n");
const bases: { name: string; med: number; fortif: number }[] = [];
for (let i = 0; i < enums.length; i++) {
  const e = enums[i]!;
  const idx = FORTIF_LEVELS.indexOf(e.cfg.fortifBase);
  const med = grid[i]![idx]!;
  bases.push({ name: e.cfg.nature, med, fortif: e.cfg.fortifBase });
  process.stdout.write(`  ${e.cfg.nature.padEnd(22)} (fortif=${e.cfg.fortifBase}) : ${fmt(med)}\n`);
}

// Inversion
process.stdout.write("\nInversion PF > FdG > PA à la fortification de base :\n");
const pa = bases[0]!.med;
const fdg = bases[1]!.med;
const pf3 = bases[2]!.med;
const pf4 = bases[3]!.med;
process.stdout.write(
  `  poste_avancé ${fmt(pa)}  <  feu_de_guet ${fmt(fdg)}  <  place_forte (3) ${fmt(pf3)}  ?  ` +
    (pa < fdg && fdg < pf3 ? "OUI" : "NON") +
    "\n",
);
process.stdout.write(
  `  poste_avancé ${fmt(pa)}  <  feu_de_guet ${fmt(fdg)}  <  place_forte (4) ${fmt(pf4)}  ?  ` +
    (pa < fdg && fdg < pf4 ? "OUI" : "NON") +
    "\n",
);
