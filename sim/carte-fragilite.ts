// npm run carte:fragilite -- --graine <bigint> --joueurs <int> [--province <id>] [--perdue <id>]
// Pour chaque lieu royaume (sauf PF), affiche combien d'AUTRES lieux royaume
// perdent leur approvisionnement s'il tombe. Trié par gravité descendante.

import { chargerConfig } from "../config/loader.js";
import { genererCarte } from "../engine/carte/generation.js";
import { calculerApprovisionnement } from "../engine/ravitaillement/index.js";
import type { LieuId, ProvinceId } from "../engine/types/carte.js";

function arg(nom: string): string | undefined {
  const idx = process.argv.indexOf(`--${nom}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function erreur(msg: string): never {
  process.stderr.write(msg + "\n");
  process.exit(1);
}

const graine_str = arg("graine");
const joueurs_str = arg("joueurs");
if (graine_str === undefined || joueurs_str === undefined) {
  erreur(
    "Usage : npm run carte:fragilite -- --graine <bigint> --joueurs <int> [--province <id>] [--perdue <id>]",
  );
}

let graine: bigint;
try {
  graine = BigInt(graine_str);
} catch {
  erreur(`--graine invalide : '${graine_str}'`);
}

const joueurs = Number.parseInt(joueurs_str, 10);
if (!Number.isInteger(joueurs) || joueurs < 1) {
  erreur("--joueurs doit être un entier >= 1");
}

const province_id = (arg("province") ?? "prov-test") as ProvinceId;
const perdue = arg("perdue");
const province_perdue_id: ProvinceId | null = perdue !== undefined ? (perdue as ProvinceId) : null;

const config = chargerConfig("./config/balance.json");
const s = genererCarte({
  graine,
  effectif_actif: joueurs,
  province_id,
  province_perdue_id,
  config,
});
const p = s.province;
const initial = calculerApprovisionnement(p.lieux, p.liens, p.place_forte_id, config);

interface Ligne {
  readonly id: LieuId;
  readonly nature: string;
  readonly terrain: string;
  readonly coupes: number;
  readonly perdants: readonly LieuId[];
}

const lignes: Ligne[] = [];
for (const candidat of p.lieux) {
  if (candidat.tenu_par !== "royaume") continue;
  if (candidat.id === p.place_forte_id) continue;

  const lieuxMod = p.lieux.map((l) =>
    l.id === candidat.id ? { ...l, tenu_par: "horde" as const } : l,
  );
  const apres = calculerApprovisionnement(lieuxMod, p.liens, p.place_forte_id, config);

  const perdants: LieuId[] = [];
  for (const other of p.lieux) {
    if (other.tenu_par !== "royaume") continue;
    if (other.id === candidat.id) continue;
    if (initial.approvisionnes.has(other.id) && !apres.approvisionnes.has(other.id)) {
      perdants.push(other.id);
    }
  }
  lignes.push({
    id: candidat.id,
    nature: candidat.nature,
    terrain: candidat.terrain,
    coupes: perdants.length,
    perdants,
  });
}

lignes.sort((a, b) => b.coupes - a.coupes || a.id.localeCompare(b.id));

const totalRoyaume = p.lieux.filter((l) => l.tenu_par === "royaume").length;

const out: string[] = [];
out.push(`Fragilité — province ${p.id}, graine ${graine.toString()}, effectif ${joueurs}`);
out.push(`Approvisionnés au départ : ${initial.approvisionnes.size} / ${totalRoyaume}`);
out.push("");
out.push("Rang  Lieu   Nature         Terrain   Impact");
out.push("-".repeat(90));
lignes.forEach((l, i) => {
  const rang = String(i + 1).padStart(4);
  const listeCourte =
    l.perdants.length === 0
      ? ""
      : l.perdants.length <= 5
        ? ` (${l.perdants.join(", ")})`
        : ` (${l.perdants.slice(0, 5).join(", ")}, …)`;
  out.push(
    `${rang}  ${l.id}   ${l.nature.padEnd(13)} ${l.terrain.padEnd(7)}  ` +
      `coupe ${String(l.coupes).padStart(2)} lieu${l.coupes > 1 ? "x" : " "}${listeCourte}`,
  );
});

process.stdout.write(out.join("\n") + "\n");
