// npm run carte:stats -- --tirages <int>
// Génère en masse sur plusieurs tailles de population, sort une distribution.
// Aide à juger si les paramètres du config produisent des cartes équilibrées.

import { chargerConfig } from "../config/loader.js";
import { genererCarte } from "../engine/carte/generation.js";
import type { LieuId, ProvinceId } from "../engine/types/carte.js";

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

interface Stat {
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

function profondeurMax(
  placeForte: LieuId,
  liens: readonly { a: LieuId; b: LieuId; nature: string }[],
  lieux: readonly { id: LieuId }[],
): number {
  const voisins = new Map<LieuId, LieuId[]>();
  for (const l of lieux) voisins.set(l.id, []);
  for (const lien of liens) {
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

const resultats: Stat[] = [];
for (const pop of POPULATIONS) {
  const stat: Stat = {
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
    if (nRoyaume < stat.lieuxMin) stat.lieuxMin = nRoyaume;
    if (nRoyaume > stat.lieuxMax) stat.lieuxMax = nRoyaume;
    stat.lieuxSomme += nRoyaume;
    if (nFosses < stat.fossesMin) stat.fossesMin = nFosses;
    if (nFosses > stat.fossesMax) stat.fossesMax = nFosses;
    stat.fossesSomme += nFosses;
    stat.goulotsSomme += s.goulots.length;
    stat.routesSomme += s.province.liens.filter((l) => l.nature === "route").length;
    stat.sentiersSomme += s.province.liens.filter((l) => l.nature === "sentier").length;
    stat.relaxation[s.niveau_relaxation]++;
    stat.profondeurMaxSomme += profondeurMax(
      s.province.place_forte_id,
      s.province.liens,
      s.province.lieux,
    );
  }
  resultats.push(stat);
}

// Rendu
const lignes: string[] = [];
lignes.push(`Distribution sur ${tirages} tirages par taille de population.`);
lignes.push("");
lignes.push(
  [
    "Pop.",
    "Lieux (min/moy/max)",
    "Fosses (min/moy/max)",
    "Prof (moy)",
    "Goulots (moy)",
    "Routes/Sentiers",
    "Relaxation 0/1/2/3",
  ].join("  "),
);
lignes.push("-".repeat(120));
for (const s of resultats) {
  const moyL = (s.lieuxSomme / tirages).toFixed(1);
  const moyF = (s.fossesSomme / tirages).toFixed(2);
  const moyP = (s.profondeurMaxSomme / tirages).toFixed(2);
  const moyG = (s.goulotsSomme / tirages).toFixed(2);
  const totalLiens = s.routesSomme + s.sentiersSomme;
  const partR = ((s.routesSomme / totalLiens) * 100).toFixed(0);
  const partS = ((s.sentiersSomme / totalLiens) * 100).toFixed(0);
  const relax = s.relaxation.join(" / ");
  const relaxTaux = s.relaxation.map((n) => `${((n / tirages) * 100).toFixed(0)}%`).join(" / ");
  lignes.push(
    `${String(s.pop).padStart(4)}  ` +
      `${String(s.lieuxMin).padStart(2)} / ${moyL.padStart(5)} / ${String(s.lieuxMax).padStart(2)}  ` +
      `      ${String(s.fossesMin).padStart(2)} / ${moyF.padStart(4)} / ${String(s.fossesMax).padStart(2)}     ` +
      `   ${moyP.padStart(5)}       ${moyG.padStart(5)}        ${partR}% / ${partS}%      ` +
      `${relax}   (${relaxTaux})`,
  );
}

process.stdout.write(lignes.join("\n") + "\n");
