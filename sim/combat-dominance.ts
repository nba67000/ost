// npm run combat:dominance
// Banc de validation du combat : pour chaque couple (répartition défensive,
// shape ennemi), cherche par dichotomie le RATIO DE BASCULE — le plus petit
// rapport F_a / F_d à partir duquel le lieu tombe.
//
// Mesure continue, plus fine que le binaire gagne/perd.

import { chargerConfig } from "../config/loader.js";
import type { Balance } from "../config/schema.js";
import { resoudreAssaut, type EntreeAssaut, type SortieAssaut } from "../engine/combat/assaut.js";
import type { EtatAbord, EtatRound } from "../engine/combat/round.js";
import type { AbordId, LieuId } from "../engine/types/carte.js";
import type { TypeForge } from "../engine/types/forge.js";
import type { Posture } from "../engine/types/garnison.js";
import type { ConditionReserve } from "../engine/types/ordre.js";

// --- Paramètres du banc ---------------------------------------------------

const TOTAL_GARNISON = 100;
const POSTURES: readonly Exclude<Posture, "reserve">[] = ["mur", "cognee", "fer"];
const TYPES: readonly TypeForge[] = ["souche", "ecorcheur", "belier", "chien_de_fosse", "muet"];

const PORTE = "porte" as AbordId;
const POTERNE = "poterne" as AbordId;

// Le ratio est exprimé en EFFECTIFS BRUTS assaillants / défenseurs.
// Volume par round = ratio × TOTAL_GARNISON. Une position défendue doit
// demander une supériorité numérique pour tomber ; c'est ce nombre qu'on lit.
const RATIO_MIN = 0.5;
const RATIO_MAX = 10.0;
const RATIO_PRECISION = 0.05;
/** Valeur sentinelle : le défenseur tient même à RATIO_MAX (imprenable). */
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

const SPLITS: readonly [number, number][] = [
  [1.0, 0.0],
  [0.75, 0.25],
  [0.5, 0.5],
  [0.25, 0.75],
  [0.0, 1.0],
];

const CONDITIONS_STANDARD: readonly ConditionReserve[] = [
  {
    ordre: 1,
    declencheur: {
      abord_id: PORTE,
      metrique: "effectif_restant_relatif",
      comparateur: "<",
      seuil: 0.5,
    },
    action: { abord_cible: PORTE, part_reserve: 1.0 },
  },
  {
    ordre: 2,
    declencheur: {
      abord_id: POTERNE,
      metrique: "effectif_restant_relatif",
      comparateur: "<",
      seuil: 0.5,
    },
    action: { abord_cible: POTERNE, part_reserve: 1.0 },
  },
];

// --- Types ----------------------------------------------------------------

interface DefStrat {
  readonly a1: number;
  readonly a2: number;
  readonly r: number;
  readonly p1: Exclude<Posture, "reserve">;
  readonly p2: Exclude<Posture, "reserve">;
  readonly label: string;
}

interface AttackShape {
  readonly composition: Readonly<Record<TypeForge, number>>;
  readonly nomCompo: string;
  readonly split1: number;
  readonly split2: number;
  readonly label: string;
}

// --- Énumération ----------------------------------------------------------

function enumererDefs(config: Balance): DefStrat[] {
  const rMax = Math.floor(config.combat.part_reserve_max * TOTAL_GARNISON);
  const strats: DefStrat[] = [];
  for (let a1 = 0; a1 <= TOTAL_GARNISON; a1 += 10) {
    for (let a2 = 0; a2 <= TOTAL_GARNISON - a1; a2 += 10) {
      const r = TOTAL_GARNISON - a1 - a2;
      if (r > rMax) continue;
      const posts1: readonly Exclude<Posture, "reserve">[] = a1 > 0 ? POSTURES : ["mur"];
      const posts2: readonly Exclude<Posture, "reserve">[] = a2 > 0 ? POSTURES : ["mur"];
      for (const p1 of posts1) {
        for (const p2 of posts2) {
          const p1c = a1 > 0 ? p1.charAt(0) : "-";
          const p2c = a2 > 0 ? p2.charAt(0) : "-";
          const label =
            `${String(a1).padStart(3)}/${String(a2).padStart(3)}/${String(r).padStart(3)}-` +
            `${p1c}${p2c}`;
          strats.push({ a1, a2, r, p1, p2, label });
        }
      }
    }
  }
  return strats;
}

function enumererShapes(): AttackShape[] {
  const shapes: AttackShape[] = [];
  for (const c of COMPOSITIONS) {
    for (const [s1, s2] of SPLITS) {
      const label = `${c.nom.padEnd(13)}-${String(Math.round(s1 * 100)).padStart(3)}/${String(Math.round(s2 * 100)).padStart(3)}`;
      shapes.push({
        composition: c.composition,
        nomCompo: c.nom,
        split1: s1,
        split2: s2,
        label,
      });
    }
  }
  return shapes;
}

// --- Combat ---------------------------------------------------------------

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
  id: AbordId,
  voisin: AbordId,
  eff: number,
  posture: Exclude<Posture, "reserve">,
): EtatAbord {
  return {
    abord_id: id,
    effectif: eff,
    effectif_initial_assaut: eff,
    posture,
    voisins: [voisin],
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

function jouerRatio(D: DefStrat, A: AttackShape, ratio: number, config: Balance): SortieAssaut {
  // volume par round en effectifs bruts = ratio × TOTAL_GARNISON
  const volume = ratio * TOTAL_GARNISON;
  const etat_initial: EtatRound = {
    lieu_id: "L001" as LieuId,
    numero_round: 1,
    abords: [abord(PORTE, POTERNE, D.a1, D.p1), abord(POTERNE, PORTE, D.a2, D.p2)],
    reserve: { effectif: D.r, effectif_initial_assaut: D.r, commandant_grade: "sergent" },
  };
  const vagues_par_round = new Map<number, Map<AbordId, Record<TypeForge, number>>>();
  for (let r = 1; r <= config.combat.rounds_max; r++) {
    const m = new Map<AbordId, Record<TypeForge, number>>();
    if (A.split1 > 0) m.set(PORTE, construireVague(volume, A.split1, A.composition));
    if (A.split2 > 0) m.set(POTERNE, construireVague(volume, A.split2, A.composition));
    vagues_par_round.set(r, m);
  }
  const entree: EntreeAssaut = {
    etat_initial,
    vagues_par_round,
    conditions_reserve: CONDITIONS_STANDARD,
    config,
  };
  return resoudreAssaut(entree);
}

/** Ratio de bascule : plus petit ratio à partir duquel le lieu tombe. */
function bascule(D: DefStrat, A: AttackShape, config: Balance): number {
  // À RATIO_MAX, si le lieu ne tombe toujours pas → défenseur imprenable.
  const haut = jouerRatio(D, A, RATIO_MAX, config);
  if (haut.issue !== "lieu_tombe") return RATIO_SENTINEL;
  // À RATIO_MIN, si le lieu tombe déjà → défenseur très fragile.
  const bas = jouerRatio(D, A, RATIO_MIN, config);
  if (bas.issue === "lieu_tombe") return RATIO_MIN;
  // Dichotomie.
  let lo = RATIO_MIN;
  let hi = RATIO_MAX;
  while (hi - lo > RATIO_PRECISION) {
    const mid = (lo + hi) / 2;
    const s = jouerRatio(D, A, mid, config);
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

// --- Main -----------------------------------------------------------------

const config = chargerConfig("./config/balance.json");
const defs = enumererDefs(config);
const shapes = enumererShapes();
const N_D = defs.length;
const N_S = shapes.length;

process.stdout.write(
  `Ratio de bascule — ${N_D} répartitions défensives × ${N_S} shapes ennemis = ` +
    `${N_D * N_S} couples.\n`,
);
process.stdout.write(
  `Chaque couple : dichotomie sur [${RATIO_MIN}, ${RATIO_MAX}], précision ${RATIO_PRECISION}.\n`,
);

const t0 = Date.now();
const basculeMat = new Float64Array(N_D * N_S);
for (let i = 0; i < N_D; i++) {
  for (let j = 0; j < N_S; j++) {
    basculeMat[i * N_S + j] = bascule(defs[i]!, shapes[j]!, config);
  }
}
process.stdout.write(`Bascules calculées en ${Date.now() - t0} ms.\n\n`);

// Statistiques par répartition
function statsD(i: number): { min: number; med: number; max: number; vals: number[] } {
  const vals: number[] = [];
  for (let j = 0; j < N_S; j++) vals.push(basculeMat[i * N_S + j]!);
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  const md = median(vals);
  return { min: mn, med: md, max: mx, vals };
}

function fmt(r: number): string {
  return r >= RATIO_SENTINEL ? ">6.00" : r.toFixed(2);
}

// --- 1. Dominance stricte défenseur ---------------------------------------

process.stdout.write("=== 1. Dominance stricte côté défenseur ===\n");
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
  process.stdout.write(`ÉCHEC : la répartition ${defs[dominantD]!.label} domine strictement.\n\n`);
} else {
  process.stdout.write("Aucune répartition ne domine strictement les autres. OK.\n\n");
}

// --- 2. MAXIMIN vs MOYENNE ------------------------------------------------

process.stdout.write("=== 2. MAXIMIN (meilleur pire) vs MOYENNE (meilleure médiane) ===\n");
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
const sMaximin = statsD(iMaximin);
const sMoyenne = statsD(iMoyenne);
process.stdout.write(
  `MAXIMIN  : ${defs[iMaximin]!.label}   pire ${fmt(sMaximin.min)}, médiane ${fmt(sMaximin.med)}, max ${fmt(sMaximin.max)}\n`,
);
process.stdout.write(
  `MOYENNE  : ${defs[iMoyenne]!.label}   pire ${fmt(sMoyenne.min)}, médiane ${fmt(sMoyenne.med)}, max ${fmt(sMoyenne.max)}\n`,
);
if (iMaximin === iMoyenne) {
  process.stdout.write("ÉCHEC : la MAXIMIN est aussi la MOYENNE.\n\n");
} else {
  const gapMed = sMoyenne.med - sMaximin.med;
  const gapMin = sMaximin.min - sMoyenne.min;
  process.stdout.write(
    `Écart : MOYENNE +${gapMed.toFixed(2)} en médiane, MAXIMIN +${gapMin.toFixed(2)} au pire.\n\n`,
  );
}

// --- 3. Contre-graphe (top 10 par médiane) --------------------------------

process.stdout.write("=== 3. Contre-graphe (top 10 par médiane) ===\n");
const parMediane = new Array(N_D)
  .fill(0)
  .map((_, i) => ({ i, ...statsD(i) }))
  .sort((a, b) => b.med - a.med || b.min - a.min);
const top10 = parMediane.slice(0, 10);
for (let rang = 0; rang < top10.length; rang++) {
  const { i, min, med } = top10[rang]!;
  const D = defs[i]!;
  let bestJ = 0;
  let bestBascule = Infinity;
  for (let j = 0; j < N_S; j++) {
    const b = basculeMat[i * N_S + j]!;
    if (b < bestBascule) {
      bestBascule = b;
      bestJ = j;
    }
  }
  const A = shapes[bestJ]!;
  process.stdout.write(
    `  Rang ${String(rang + 1).padStart(2)} ${D.label}  méd ${fmt(med)}  →  pire ${fmt(min)} contre ${A.label}\n`,
  );
}
process.stdout.write("\n");

// --- 4. Dominance côté horde ----------------------------------------------

process.stdout.write("=== 4. Dominance côté horde ===\n");
// Pour chaque shape, calculer la bascule du défenseur qui résiste le mieux
// (max_D). Si ce max est bas, aucun défenseur ne résiste, shape dominante.
const parShape: { j: number; maxD: number; minD: number; medD: number; label: string }[] = [];
for (let j = 0; j < N_S; j++) {
  const vals: number[] = [];
  for (let i = 0; i < N_D; i++) vals.push(basculeMat[i * N_S + j]!);
  parShape.push({
    j,
    maxD: Math.max(...vals),
    minD: Math.min(...vals),
    medD: median(vals),
    label: shapes[j]!.label,
  });
}
parShape.sort((a, b) => a.maxD - b.maxD);
const shapeLePlusDur = parShape[0]!;
process.stdout.write(
  `Shape ennemi qui plafonne le plus les défenseurs (max_D le plus bas) :\n` +
    `  ${shapeLePlusDur.label}   min_D ${fmt(shapeLePlusDur.minD)}, méd_D ${fmt(shapeLePlusDur.medD)}, max_D ${fmt(shapeLePlusDur.maxD)}\n`,
);
if (shapeLePlusDur.maxD < 1.0) {
  process.stdout.write(
    `ÉCHEC : même le meilleur défenseur ne résiste pas au-delà du ratio ${fmt(shapeLePlusDur.maxD)}.\n\n`,
  );
} else {
  process.stdout.write("Aucune composition ne plafonne les défenseurs sous 1.0. OK.\n\n");
}

// --- Distribution top 20 --------------------------------------------------

process.stdout.write("=== Distribution — 20 meilleures répartitions (par médiane) ===\n");
process.stdout.write(`Rang  Répartition               Pire    Méd     Max\n`);
const top20 = parMediane.slice(0, 20);
for (let rang = 0; rang < top20.length; rang++) {
  const { i, min, med, max } = top20[rang]!;
  const D = defs[i]!;
  process.stdout.write(
    `  ${String(rang + 1).padStart(2)}  ${D.label.padEnd(22)}  ` +
      `${fmt(min).padStart(5)}   ${fmt(med).padStart(5)}   ${fmt(max).padStart(5)}\n`,
  );
}
