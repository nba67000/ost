// npm run carte -- --graine <bigint> --joueurs <int> [--province <id>] [--perdue <id>]
// Génère une carte à la graine et à l'effectif donnés, l'affiche en texte lisible.

import { chargerConfig } from "../config/loader.js";
import { genererCarte } from "../engine/carte/generation.js";
import type { ProvinceId } from "../engine/types/carte.js";

function arg(nom: string): string | undefined {
  const idx = process.argv.indexOf(`--${nom}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function ecrireErreur(msg: string): never {
  process.stderr.write(msg + "\n");
  process.exit(1);
}

const graine_str = arg("graine");
const joueurs_str = arg("joueurs");
if (graine_str === undefined || joueurs_str === undefined) {
  ecrireErreur(
    "Usage : npm run carte -- --graine <bigint> --joueurs <int> [--province <id>] [--perdue <id>]",
  );
}

let graine: bigint;
try {
  graine = BigInt(graine_str);
} catch {
  ecrireErreur(`--graine invalide : '${graine_str}'`);
}

const joueurs = Number.parseInt(joueurs_str, 10);
if (!Number.isInteger(joueurs) || joueurs < 1) {
  ecrireErreur("--joueurs doit être un entier >= 1");
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
const goulotsSet = new Set<string>(s.goulots);
const fossesSet = new Set<string>(p.fosses);

const lignes: string[] = [];
lignes.push(`Carte — province ${p.id}, graine ${graine.toString()}, effectif ${joueurs}`);
lignes.push(
  `Essais utilisés : ${s.essais_utilises}, niveau de relâchement : ${s.niveau_relaxation}`,
);
if (province_perdue_id !== null) lignes.push(`Province perdue précédente : ${province_perdue_id}`);
lignes.push("");
lignes.push(`Lieux (${p.lieux.length}) :`);
for (const l of p.lieux) {
  const tags: string[] = [];
  if (l.id === p.place_forte_id) tags.push("PF");
  if (goulotsSet.has(l.id)) tags.push("goulot");
  if (l.id === p.entree_principale) tags.push("entrée principale");
  else if (p.entrees.includes(l.id)) tags.push("entrée");
  if (fossesSet.has(l.id)) tags.push("fosse");
  const tagStr = tags.length ? `  [${tags.join(", ")}]` : "";
  const secteur = l.secteur_id ?? "-";
  lignes.push(
    `  ${l.id}  ${l.nature.padEnd(13)} ${l.terrain.padEnd(7)} ` +
      `${String(l.abords.length).padStart(2)} abords  sec:${String(secteur).padEnd(3)}` +
      `  (${l.tenu_par})${tagStr}`,
  );
}
lignes.push("");
lignes.push(`Liens (${p.liens.length}) :`);
for (const lien of p.liens) {
  lignes.push(`  ${lien.a} -- ${lien.nature.padEnd(7)} -- ${lien.b}`);
}
lignes.push("");
lignes.push(`Entrées           : ${p.entrees.join(", ")}`);
lignes.push(`Entrée principale : ${p.entree_principale}`);
lignes.push(`Fosses            : ${p.fosses.length > 0 ? p.fosses.join(", ") : "(aucune)"}`);
lignes.push(`Goulots           : ${s.goulots.length > 0 ? s.goulots.join(", ") : "(aucun)"}`);

process.stdout.write(lignes.join("\n") + "\n");
