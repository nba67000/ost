// npm run carte:stats -- --tirages <int>
// Génère en masse sur plusieurs tailles de population, sort deux tableaux :
// (1) distribution des cartes retenues, (2) diagnostic par essai.

import { chargerConfig } from "../config/loader.js";
import type { MotifRejet } from "../engine/carte/generation.js";
import { genererCarte } from "../engine/carte/generation.js";
import type { LieuId, Province, ProvinceId } from "../engine/types/carte.js";

function arg(nom: string): string | undefined {
  const idx = process.argv.indexOf(`--${nom}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

const tirages_str = arg("tirages") ?? "100";
const tirages = Number.parseInt(tirages_str, 10);
if (!Number.isInteger(tirages) || tirages < 1) {
  process.stderr.write("--tirages doit être un entier >= 1\n");
  process.exit(1);
}

const POPULATIONS: readonly number[] = [2, 5, 15, 40, 60, 100, 200];
const config = chargerConfig("./config/balance.json");

interface StatCarte {
  readonly pop: number;
  lieuxMin: number;
  lieuxMax: number;
  lieuxSomme: number;
  fossesMin: number;
  fossesMax: number;
  fossesSomme: number;
  goulotsSomme: number;
  profondeurMaxSomme: number;
  routesSomme: number;
  sentiersSomme: number;
  relaxation: [number, number, number, number];
}

interface StatDiagnostic {
  readonly pop: number;
  essaisTotal: number;
  D_tire: Map<number, number>; // valeur → occurrences (tous essais)
  D_retenu: Map<number, number>; // valeur → occurrences (essais retenus)
  motifs: Record<MotifRejet | "retenu", number>;
}

function profondeurRoutes(placeForte: LieuId, p: Province): number {
  const voisins = new Map<LieuId, LieuId[]>();
  for (const l of p.lieux) voisins.set(l.id, []);
  for (const lien of p.liens) {
    if (lien.nature !== "route") continue;
    voisins.get(lien.a)!.push(lien.b);
    voisins.get(lien.b)!.push(lien.a);
  }
  const dist = new Map<LieuId, number>([[placeForte, 0]]);
  const file: LieuId[] = [placeForte];
  let head = 0;
  let max = 0;
  while (head < file.length) {
    const cur = file[head++]!;
    const d = dist.get(cur)!;
    if (d > max) max = d;
    for (const v of voisins.get(cur) ?? []) {
      if (!dist.has(v)) {
        dist.set(v, d + 1);
        file.push(v);
      }
    }
  }
  return max;
}

function inc<K>(m: Map<K, number>, k: K): void {
  m.set(k, (m.get(k) ?? 0) + 1);
}

const cartes: StatCarte[] = [];
const diags: StatDiagnostic[] = [];

for (const pop of POPULATIONS) {
  const carte: StatCarte = {
    pop,
    lieuxMin: Number.POSITIVE_INFINITY,
    lieuxMax: 0,
    lieuxSomme: 0,
    fossesMin: Number.POSITIVE_INFINITY,
    fossesMax: 0,
    fossesSomme: 0,
    goulotsSomme: 0,
    profondeurMaxSomme: 0,
    routesSomme: 0,
    sentiersSomme: 0,
    relaxation: [0, 0, 0, 0],
  };
  const diag: StatDiagnostic = {
    pop,
    essaisTotal: 0,
    D_tire: new Map(),
    D_retenu: new Map(),
    motifs: {
      arithmetique_impossible: 0,
      goulots_trop_peu: 0,
      goulots_trop_nombreux: 0,
      profondeur_depassee: 0,
      retenu: 0,
    },
  };

  for (let i = 0; i < tirages; i++) {
    const s = genererCarte({
      graine: BigInt(i + 1),
      effectif_actif: pop,
      province_id: `prov-${pop}` as ProvinceId,
      province_perdue_id: null,
      config,
    });

    const nRoyaume = s.province.lieux.filter((l) => l.tenu_par === "royaume").length;
    const nFosses = s.province.fosses.length;
    if (nRoyaume < carte.lieuxMin) carte.lieuxMin = nRoyaume;
    if (nRoyaume > carte.lieuxMax) carte.lieuxMax = nRoyaume;
    carte.lieuxSomme += nRoyaume;
    if (nFosses < carte.fossesMin) carte.fossesMin = nFosses;
    if (nFosses > carte.fossesMax) carte.fossesMax = nFosses;
    carte.fossesSomme += nFosses;
    carte.goulotsSomme += s.goulots.length;
    carte.routesSomme += s.province.liens.filter((l) => l.nature === "route").length;
    carte.sentiersSomme += s.province.liens.filter((l) => l.nature === "sentier").length;
    carte.relaxation[s.niveau_relaxation]++;
    carte.profondeurMaxSomme += profondeurRoutes(s.province.place_forte_id, s.province);

    for (const d of s.diagnostic) {
      diag.essaisTotal++;
      if (d.D_tire !== null) inc(diag.D_tire, d.D_tire);
      if (d.motif_rejet === null) {
        diag.motifs.retenu++;
        if (d.D_tire !== null) inc(diag.D_retenu, d.D_tire);
      } else {
        diag.motifs[d.motif_rejet]++;
      }
    }
  }
  cartes.push(carte);
  diags.push(diag);
}

// --- Rendu -----------------------------------------------------------------

const lignes: string[] = [];
lignes.push(`Distribution sur ${tirages} tirages par taille de population.`);
lignes.push("");
lignes.push(
  "Pop.  Lieux (min/moy/max)  Fosses (min/moy/max)  Prof (moy)  Goulots (moy)  Rt/Sent    Relaxation 0/1/2/3",
);
lignes.push("-".repeat(110));
for (const s of cartes) {
  const moyL = (s.lieuxSomme / tirages).toFixed(1);
  const moyF = (s.fossesSomme / tirages).toFixed(2);
  const moyP = (s.profondeurMaxSomme / tirages).toFixed(2);
  const moyG = (s.goulotsSomme / tirages).toFixed(2);
  const totalLiens = s.routesSomme + s.sentiersSomme;
  const partR = ((s.routesSomme / totalLiens) * 100).toFixed(0);
  const partS = ((s.sentiersSomme / totalLiens) * 100).toFixed(0);
  const relaxTaux = s.relaxation.map((n) => `${((n / tirages) * 100).toFixed(0)}%`).join("/");
  lignes.push(
    `${String(s.pop).padStart(4)}    ` +
      `${String(s.lieuxMin).padStart(2)}/${moyL.padStart(5)}/${String(s.lieuxMax).padStart(2)}         ` +
      `${String(s.fossesMin).padStart(2)}/${moyF.padStart(4)}/${String(s.fossesMax).padStart(2)}         ` +
      `${moyP.padStart(4)}         ${moyG.padStart(4)}       ${partR.padStart(2)}%/${partS.padStart(2)}%       ${relaxTaux}`,
  );
}

lignes.push("");
lignes.push("");
lignes.push("Diagnostic — instrumentation temporaire pour comprendre la sélection.");
lignes.push("");
lignes.push(
  "Pop.  Essais/tirage   D tiré (dist)          D retenu (dist)         Rejets/essai : arith / g_peu / g_nb / prof",
);
lignes.push("-".repeat(130));
for (const d of diags) {
  const essaisMoy = (d.essaisTotal / tirages).toFixed(2);
  const distStr = (m: Map<number, number>, tot: number): string => {
    if (tot === 0) return "-";
    const cles = [...m.keys()].sort((a, b) => a - b);
    return cles.map((k) => `${k}:${((m.get(k)! / tot) * 100).toFixed(0)}%`).join(" ");
  };
  const dTire = distStr(d.D_tire, d.essaisTotal);
  const dRetenu = distStr(d.D_retenu, d.motifs.retenu);
  const denom = d.essaisTotal;
  const taux = (n: number): string => `${((n / denom) * 100).toFixed(1)}%`;
  lignes.push(
    `${String(d.pop).padStart(4)}    ` +
      `${essaisMoy.padStart(4)}           ` +
      `${dTire.padEnd(20)}   ` +
      `${dRetenu.padEnd(20)}   ` +
      `${taux(d.motifs.arithmetique_impossible)} / ${taux(d.motifs.goulots_trop_peu)} / ` +
      `${taux(d.motifs.goulots_trop_nombreux)} / ${taux(d.motifs.profondeur_depassee)}`,
  );
}

process.stdout.write(lignes.join("\n") + "\n");
