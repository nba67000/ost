// npm run combat:dominance
// Banc de validation du combat, paramétré par le nombre d'abords (k).
// Pour chaque couple (répartition défensive, shape ennemi), cherche par
// dichotomie le RATIO DE BASCULE en EFFECTIFS BRUTS assaillants/défenseurs.
//
// Canonicalise les répartitions symétriques (miroir) : sur un lieu à abords
// équivalents, (10, 60, 30) et (60, 10, 30) sont la même stratégie. Sinon
// le top 10 ne contient que la moitié de stratégies réelles.

import { chargerConfig } from "../config/loader.js";
import type { Balance } from "../config/schema.js";
import { resoudreAssaut, type EntreeAssaut, type SortieAssaut } from "../engine/combat/assaut.js";
import type { EtatAbord, EtatRound } from "../engine/combat/round.js";
import type { AbordId, LieuId } from "../engine/types/carte.js";
import type { TypeForge } from "../engine/types/forge.js";
import type { Posture } from "../engine/types/garnison.js";
import type { ConditionReserve } from "../engine/types/ordre.js";

// --- Paramètres --------------------------------------------------------

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
  readonly label: string;
}

const BENCHES: readonly BenchConfig[] = [
  { k: 2, pasDef: 10, pasSplit: 10, label: "Feu de guet (2 abords)" },
  { k: 3, pasDef: 10, pasSplit: 25, label: "3 abords" },
  { k: 4, pasDef: 20, pasSplit: 25, label: "Place forte (4 abords)" },
];

// --- Types -----------------------------------------------------------

type PostureOrNone = Exclude<Posture, "reserve"> | "-";

interface DefStrat {
  readonly abords: readonly number[];
  readonly postures: readonly PostureOrNone[];
  readonly r: number;
  readonly label: string;
}

interface AttackShape {
  readonly splits: readonly number[]; // fractions summant à 1
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
    // enumerate posture combos
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

function abord(i: number, k: number, eff: number, posture: PostureOrNone): EtatAbord {
  // Si effectif nul, la posture est arbitraire (n'entre pas dans le combat).
  const p: Exclude<Posture, "reserve"> = posture === "-" ? "mur" : posture;
  return {
    abord_id: abordId(i),
    effectif: eff,
    effectif_initial_assaut: eff,
    posture: p,
    voisins: voisinsAnneau(i, k).map(abordId),
    fortification_niveau: 1,
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

function jouerRatio(D: DefStrat, A: AttackShape, ratio: number, balance: Balance): SortieAssaut {
  const volume = ratio * TOTAL_GARNISON;
  const k = D.abords.length;
  const abords: EtatAbord[] = D.abords.map((a, i) => abord(i, k, a, D.postures[i]!));
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

function bascule(D: DefStrat, A: AttackShape, balance: Balance): number {
  const haut = jouerRatio(D, A, RATIO_MAX, balance);
  if (haut.issue !== "lieu_tombe") return RATIO_SENTINEL;
  const bas = jouerRatio(D, A, RATIO_MIN, balance);
  if (bas.issue === "lieu_tombe") return RATIO_MIN;
  let lo = RATIO_MIN;
  let hi = RATIO_MAX;
  while (hi - lo > RATIO_PRECISION) {
    const mid = (lo + hi) / 2;
    const s = jouerRatio(D, A, mid, balance);
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

// --- Analyse -----------------------------------------------------------

function runBench(cfg: BenchConfig, balance: Balance): void {
  const defs = enumererDefs(cfg, balance);
  const shapes = enumererShapes(cfg);
  const N_D = defs.length;
  const N_S = shapes.length;

  process.stdout.write(
    `\n\n=== ${cfg.label} : ${N_D} répartitions canoniques × ${N_S} shapes ` +
      `= ${N_D * N_S} couples (pas def ${cfg.pasDef}%, pas split ${cfg.pasSplit}%) ===\n`,
  );

  const t0 = Date.now();
  const basculeMat = new Float64Array(N_D * N_S);
  for (let i = 0; i < N_D; i++) {
    for (let j = 0; j < N_S; j++) {
      basculeMat[i * N_S + j] = bascule(defs[i]!, shapes[j]!, balance);
    }
  }
  process.stdout.write(`Calculées en ${Date.now() - t0} ms.\n\n`);

  function statsD(i: number): { min: number; med: number; max: number } {
    const vals: number[] = [];
    for (let j = 0; j < N_S; j++) vals.push(basculeMat[i * N_S + j]!);
    return { min: Math.min(...vals), med: median(vals), max: Math.max(...vals) };
  }

  // 1. Dominance stricte défenseur
  process.stdout.write("1. Dominance stricte défenseur : ");
  let dominantD: number | null = null;
  for (let i = 0; i < N_D; i++) {
    let alwaysGeq = true;
    let anyStrict = false;
    for (let k = 0; k < N_D; k++) {
      if (k === i) continue;
      let subGeq = true;
      let subStrict = false;
      for (let j = 0; j < N_S; j++) {
        const b1 = basculeMat[i * N_S + j]!;
        const b2 = basculeMat[k * N_S + j]!;
        if (b1 < b2) {
          subGeq = false;
          break;
        }
        if (b1 > b2) subStrict = true;
      }
      if (!subGeq) {
        alwaysGeq = false;
        break;
      }
      if (subStrict) anyStrict = true;
    }
    if (alwaysGeq && anyStrict) {
      dominantD = i;
      break;
    }
  }
  if (dominantD !== null) {
    process.stdout.write(`ÉCHEC — ${defs[dominantD]!.label} domine.\n`);
  } else {
    process.stdout.write("aucune. OK.\n");
  }

  // 2. MAXIMIN vs MOYENNE
  let iMaximin = 0;
  let iMoyenne = 0;
  let bestMin = -Infinity;
  let bestMed = -Infinity;
  for (let i = 0; i < N_D; i++) {
    const s = statsD(i);
    if (s.min > bestMin) {
      bestMin = s.min;
      iMaximin = i;
    }
    if (s.med > bestMed) {
      bestMed = s.med;
      iMoyenne = i;
    }
  }
  const sMax = statsD(iMaximin);
  const sMoy = statsD(iMoyenne);
  process.stdout.write(
    `2. MAXIMIN : ${defs[iMaximin]!.label}  pire ${fmt(sMax.min)}, méd ${fmt(sMax.med)}, max ${fmt(sMax.max)}\n`,
  );
  process.stdout.write(
    `   MOYENNE : ${defs[iMoyenne]!.label}  pire ${fmt(sMoy.min)}, méd ${fmt(sMoy.med)}, max ${fmt(sMoy.max)}\n`,
  );
  if (iMaximin === iMoyenne) {
    process.stdout.write("   ÉCHEC : identiques.\n");
  } else {
    const gapMed = sMoy.med - sMax.med;
    const gapMin = sMax.min - sMoy.min;
    process.stdout.write(
      `   Écart : MOYENNE +${gapMed.toFixed(2)} en méd, MAXIMIN +${gapMin.toFixed(2)} au pire.\n`,
    );
  }

  // 3. Contre-graphe (top 10 par médiane)
  const parMediane = new Array(N_D)
    .fill(0)
    .map((_, i) => ({ i, ...statsD(i) }))
    .sort((a, b) => b.med - a.med || b.min - a.min);
  process.stdout.write("3. Top 10 par médiane :\n");
  for (let rang = 0; rang < Math.min(10, parMediane.length); rang++) {
    const { i, med } = parMediane[rang]!;
    let bestJ = 0;
    let bestBascule = Infinity;
    for (let j = 0; j < N_S; j++) {
      const b = basculeMat[i * N_S + j]!;
      if (b < bestBascule) {
        bestBascule = b;
        bestJ = j;
      }
    }
    process.stdout.write(
      `  ${String(rang + 1).padStart(2)}. ${defs[i]!.label}  méd ${fmt(med)}  ` +
        `→ pire ${fmt(bestBascule)} contre ${shapes[bestJ]!.label}\n`,
    );
  }

  // 4. Dominance côté horde
  const parShape: { j: number; maxD: number; medD: number; label: string }[] = [];
  for (let j = 0; j < N_S; j++) {
    const vals: number[] = [];
    for (let i = 0; i < N_D; i++) vals.push(basculeMat[i * N_S + j]!);
    parShape.push({
      j,
      maxD: Math.max(...vals),
      medD: median(vals),
      label: shapes[j]!.label,
    });
  }
  parShape.sort((a, b) => a.maxD - b.maxD);
  const dur = parShape[0]!;
  process.stdout.write(
    `4. Shape le plus dur : ${dur.label}  max_D ${fmt(dur.maxD)}, méd_D ${fmt(dur.medD)}\n`,
  );
  if (dur.maxD < 1.0) {
    process.stdout.write(`   ÉCHEC : max_D < 1.0.\n`);
  } else {
    process.stdout.write(`   OK (aucune composition ne plafonne sous 1.0).\n`);
  }
}

// --- Main -----------------------------------------------------------

const config = chargerConfig("./config/balance.json");
process.stdout.write(
  `Ratio de bascule en EFFECTIFS BRUTS (attaquant / défenseur), ` +
    `dichotomie [${RATIO_MIN}, ${RATIO_MAX}], précision ${RATIO_PRECISION}.\n`,
);
for (const cfg of BENCHES) {
  runBench(cfg, config);
}
