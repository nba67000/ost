// npm run combat:dominance
// Jalon de validation du combat : construit une matrice de gains
// (répartitions défensives) × (compositions ennemies) et sort quatre
// diagnostics sur l'existence d'arbitrages stratégiques.

import { chargerConfig } from "../config/loader.js";
import type { Balance } from "../config/schema.js";
import { resoudreAssaut, type EntreeAssaut, type SortieAssaut } from "../engine/combat/assaut.js";
import type { EtatAbord, EtatRound } from "../engine/combat/round.js";
import type { AbordId, LieuId } from "../engine/types/carte.js";
import type { TypeForge } from "../engine/types/forge.js";
import type { Posture } from "../engine/types/garnison.js";
import type { ConditionReserve } from "../engine/types/ordre.js";

// --- Paramètres du banc d'essai -------------------------------------------

const TOTAL_GARNISON = 100;
const POSTURES: readonly Exclude<Posture, "reserve">[] = ["mur", "cognee", "fer"];
const TYPES: readonly TypeForge[] = ["souche", "ecorcheur", "belier", "chien_de_fosse", "muet"];

const PORTE = "porte" as AbordId;
const POTERNE = "poterne" as AbordId;

const VOLUMES: readonly number[] = [14, 20, 26]; // 70/100/130 % de parité par round

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

interface StratAttaque {
  readonly volume: number;
  readonly composition: Readonly<Record<TypeForge, number>>;
  readonly nomCompo: string;
  readonly split1: number;
  readonly split2: number;
  readonly label: string;
}

// --- Énumération -----------------------------------------------------------

function enumererDefs(): DefStrat[] {
  const strats: DefStrat[] = [];
  for (let a1 = 0; a1 <= TOTAL_GARNISON; a1 += 10) {
    for (let a2 = 0; a2 <= TOTAL_GARNISON - a1; a2 += 10) {
      const r = TOTAL_GARNISON - a1 - a2;
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

function enumererAtks(): StratAttaque[] {
  const strats: StratAttaque[] = [];
  for (const volume of VOLUMES) {
    for (const c of COMPOSITIONS) {
      for (const [s1, s2] of SPLITS) {
        const label = `v${String(volume).padStart(2)}-${c.nom.padEnd(13)}-${Math.round(s1 * 100)}/${Math.round(s2 * 100)}`;
        strats.push({
          volume,
          composition: c.composition,
          nomCompo: c.nom,
          split1: s1,
          split2: s2,
          label,
        });
      }
    }
  }
  return strats;
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
  };
}

function jouer(D: DefStrat, A: StratAttaque, config: Balance): SortieAssaut {
  const etat_initial: EtatRound = {
    lieu_id: "L001" as LieuId,
    numero_round: 1,
    abords: [abord(PORTE, POTERNE, D.a1, D.p1), abord(POTERNE, PORTE, D.a2, D.p2)],
    reserve: { effectif: D.r, effectif_initial_assaut: D.r, commandant_grade: "sergent" },
  };
  const vagues_par_round = new Map<number, Map<AbordId, Record<TypeForge, number>>>();
  for (let r = 1; r <= config.combat.rounds_max; r++) {
    const m = new Map<AbordId, Record<TypeForge, number>>();
    if (A.split1 > 0) m.set(PORTE, construireVague(A.volume, A.split1, A.composition));
    if (A.split2 > 0) m.set(POTERNE, construireVague(A.volume, A.split2, A.composition));
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

function encoder(gagne: boolean, marge: number): number {
  return gagne ? 10000 + marge : marge;
}

// --- Main -----------------------------------------------------------------

const config = chargerConfig("./config/balance.json");
const defs = enumererDefs();
const atks = enumererAtks();
const N_D = defs.length;
const N_A = atks.length;

process.stdout.write(
  `Matrice de gains — ${N_D} répartitions défensives × ${N_A} compositions ennemies = ` +
    `${N_D * N_A} combats.\n`,
);

const t0 = Date.now();
// Matrices : score encodé, gagne, marge
const score = new Float64Array(N_D * N_A);
const gagne = new Uint8Array(N_D * N_A);
for (let i = 0; i < N_D; i++) {
  const D = defs[i]!;
  for (let j = 0; j < N_A; j++) {
    const A = atks[j]!;
    const s = jouer(D, A, config);
    const g = s.issue !== "lieu_tombe";
    let marge = s.etat_final.reserve.effectif;
    for (const a of s.etat_final.abords) marge += a.effectif;
    score[i * N_A + j] = encoder(g, marge);
    gagne[i * N_A + j] = g ? 1 : 0;
  }
}
process.stdout.write(`Combats terminés en ${Date.now() - t0} ms.\n\n`);

// --- 1. Dominance stricte défenseur ---------------------------------------

process.stdout.write("=== 1. Dominance stricte côté défenseur ===\n");
let dominantD: DefStrat | null = null;
for (let i = 0; i < N_D; i++) {
  let alwaysGeq = true;
  let anyStrict = false;
  for (let k = 0; k < N_D; k++) {
    if (k === i) continue;
    let subGeq = true;
    let subStrict = false;
    for (let j = 0; j < N_A; j++) {
      const s1 = score[i * N_A + j]!;
      const s2 = score[k * N_A + j]!;
      if (s1 < s2) {
        subGeq = false;
        break;
      }
      if (s1 > s2) subStrict = true;
    }
    if (!subGeq) {
      alwaysGeq = false;
      break;
    }
    if (subStrict) anyStrict = true;
  }
  if (alwaysGeq && anyStrict) {
    dominantD = defs[i]!;
    break;
  }
}
if (dominantD !== null) {
  process.stdout.write(
    `ÉCHEC : la répartition ${dominantD.label} domine strictement toutes les autres.\n\n`,
  );
} else {
  process.stdout.write("Aucune répartition ne domine strictement les autres. OK.\n\n");
}

// --- 2. MAXIMIN vs MOYENNE ------------------------------------------------

process.stdout.write("=== 2. MAXIMIN vs MOYENNE ===\n");
function statsPour(i: number): { pire: number; moy: number; win: number } {
  let pire = Number.POSITIVE_INFINITY;
  let sum = 0;
  let wins = 0;
  for (let j = 0; j < N_A; j++) {
    const s = score[i * N_A + j]!;
    if (s < pire) pire = s;
    sum += s;
    if (gagne[i * N_A + j] === 1) wins++;
  }
  return { pire, moy: sum / N_A, win: wins / N_A };
}

let iMaximin = 0;
let iMean = 0;
let maximinScore = Number.NEGATIVE_INFINITY;
let meanScore = Number.NEGATIVE_INFINITY;
for (let i = 0; i < N_D; i++) {
  const st = statsPour(i);
  if (st.pire > maximinScore) {
    maximinScore = st.pire;
    iMaximin = i;
  }
  if (st.moy > meanScore) {
    meanScore = st.moy;
    iMean = i;
  }
}
const stMax = statsPour(iMaximin);
const stMean = statsPour(iMean);
process.stdout.write(
  `MAXIMIN  : ${defs[iMaximin]!.label}   pire cas ${stMax.pire.toFixed(0)}, ` +
    `moyenne ${stMax.moy.toFixed(0)}, win ${(stMax.win * 100).toFixed(0)}%\n`,
);
process.stdout.write(
  `MOYENNE  : ${defs[iMean]!.label}   pire cas ${stMean.pire.toFixed(0)}, ` +
    `moyenne ${stMean.moy.toFixed(0)}, win ${(stMean.win * 100).toFixed(0)}%\n`,
);
if (iMaximin === iMean) {
  process.stdout.write(
    "ÉCHEC : la MAXIMIN est aussi la MOYENNE — aucun arbitrage prudence/audace.\n\n",
  );
} else {
  const ecartMoy = stMean.moy - stMax.moy;
  const ecartPire = stMax.pire - stMean.pire;
  process.stdout.write(
    `Écart : la MOYENNE gagne +${ecartMoy.toFixed(0)} en score moyen, ` +
      `la MAXIMIN gagne +${ecartPire.toFixed(0)} au pire cas. OK.\n\n`,
  );
}

// --- 3. Contre-graphe (top 10) --------------------------------------------

process.stdout.write("=== 3. Contre-graphe (top 10 par taux de victoire) ===\n");
const parWin = new Array(N_D)
  .fill(0)
  .map((_, i) => ({ i, ...statsPour(i) }))
  .sort((a, b) => b.win - a.win || b.moy - a.moy);
const top10 = parWin.slice(0, 10);
for (let rang = 0; rang < top10.length; rang++) {
  const { i, win, moy } = top10[rang]!;
  const D = defs[i]!;
  let bestJ = -1;
  let bestMarge = Number.POSITIVE_INFINITY;
  for (let j = 0; j < N_A; j++) {
    if (gagne[i * N_A + j] === 0) {
      const marge = score[i * N_A + j]!;
      if (marge < bestMarge) {
        bestMarge = marge;
        bestJ = j;
      }
    }
  }
  if (bestJ === -1) {
    process.stdout.write(
      `  Rang ${String(rang + 1).padStart(2)} ${D.label}  win 100%  moy ${moy.toFixed(0)}  →  AUCUN CONTRE (trou)\n`,
    );
  } else {
    const A = atks[bestJ]!;
    process.stdout.write(
      `  Rang ${String(rang + 1).padStart(2)} ${D.label}  win ${(win * 100).toFixed(0)}%  ` +
        `moy ${moy.toFixed(0)}  →  battue par ${A.label}  (marge ${bestMarge.toFixed(0)})\n`,
    );
  }
}
process.stdout.write("\n");

// --- 4. Dominance côté horde ----------------------------------------------

process.stdout.write("=== 4. Dominance côté horde ===\n");
let unbeatable = -1;
for (let j = 0; j < N_A; j++) {
  let beatsAll = true;
  for (let i = 0; i < N_D; i++) {
    if (gagne[i * N_A + j] === 1) {
      beatsAll = false;
      break;
    }
  }
  if (beatsAll) {
    unbeatable = j;
    break;
  }
}
if (unbeatable !== -1) {
  process.stdout.write(
    `ÉCHEC : la composition ${atks[unbeatable]!.label} bat toutes les répartitions défensives.\n\n`,
  );
} else {
  process.stdout.write("Aucune composition ne bat toutes les répartitions défensives. OK.\n\n");
}

// --- Distribution top 20 --------------------------------------------------

process.stdout.write("=== Distribution — 20 meilleures répartitions ===\n");
process.stdout.write(`Rang  Répartition                Win     Moyenne    Pire\n`);
const top20 = parWin.slice(0, 20);
for (let rang = 0; rang < top20.length; rang++) {
  const { i, win, moy, pire } = top20[rang]!;
  const D = defs[i]!;
  process.stdout.write(
    `  ${String(rang + 1).padStart(2)}  ${D.label.padEnd(24)}  ${String(Math.round(win * 100)).padStart(3)}%   ` +
      `${moy.toFixed(0).padStart(6)}   ${pire.toFixed(0).padStart(5)}\n`,
  );
}
