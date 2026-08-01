// npm run carte:fragilite -- --graine <bigint> --joueurs <int> [--province <id>] [--perdue <id>]
// Pour chaque lieu royaume (sauf PF), affiche combien d'AUTRES lieux royaume
// perdent leur approvisionnement s'il tombe. Trié par gravité descendante.

import { chargerConfig } from "../config/loader.js";
import { genererCarte } from "../engine/carte/generation.js";
import { calculerFragilite, fragiliteParRang } from "../engine/carte/fragilite.js";
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

const royaumeIds = new Set<LieuId>(
  p.lieux.filter((l) => l.tenu_par === "royaume").map((l) => l.id),
);
const impacts = fragiliteParRang(calculerFragilite(royaumeIds, p.liens, p.place_forte_id));

const infoLieu = new Map(p.lieux.map((l) => [l.id, l]));
const totalRoyaume = royaumeIds.size;

const out: string[] = [];
out.push(`Fragilité — province ${p.id}, graine ${graine.toString()}, effectif ${joueurs}`);
out.push(`Royaume : ${totalRoyaume} lieux`);
out.push("");
out.push("Rang  Lieu   Nature         Terrain   Impact");
out.push("-".repeat(90));
impacts.forEach((imp, i) => {
  const rang = String(i + 1).padStart(4);
  const info = infoLieu.get(imp.lieu_id);
  const nature = (info?.nature ?? "?").padEnd(13);
  const terrain = (info?.terrain ?? "?").padEnd(7);
  const pct = totalRoyaume > 0 ? ((imp.coupes / totalRoyaume) * 100).toFixed(0) : "?";
  out.push(
    `${rang}  ${imp.lieu_id}   ${nature} ${terrain}  ` +
      `coupe ${String(imp.coupes).padStart(2)} lieu${imp.coupes > 1 ? "x" : " "}  (${pct.padStart(2)}%)`,
  );
});

process.stdout.write(out.join("\n") + "\n");
