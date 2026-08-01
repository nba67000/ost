// Chargeur typé de config/balance.json.
// Échoue au démarrage avec le chemin exact de la clé manquante ou du type incorrect.
// Aucun fallback silencieux, aucune valeur par défaut. Voir CLAUDE.md.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Balance, SchemaNoeud, SchemaFeuille } from "./schema.js";
import { SCHEMA } from "./schema.js";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function estObjetPlat(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function valider(valeur: unknown, schema: SchemaNoeud, chemin: string): void {
  if (!estObjetPlat(valeur)) {
    throw new ConfigError(
      `config: '${chemin || "<racine>"}' doit être un objet, reçu ${typeof valeur}`,
    );
  }
  for (const [cle, attendu] of Object.entries(schema)) {
    const cheminCle = chemin === "" ? cle : `${chemin}.${cle}`;
    if (!(cle in valeur)) {
      throw new ConfigError(`config: clé manquante à '${cheminCle}'`);
    }
    const v = valeur[cle];
    if (typeof attendu === "string") {
      validerFeuille(v, attendu, cheminCle);
    } else {
      valider(v, attendu, cheminCle);
    }
  }
}

function validerFeuille(v: unknown, attendu: SchemaFeuille, chemin: string): void {
  if (attendu === "object") {
    if (!estObjetPlat(v)) {
      throw new ConfigError(`config: '${chemin}' doit être un objet, reçu ${typeof v}`);
    }
    return;
  }
  if (typeof v !== attendu) {
    throw new ConfigError(`config: '${chemin}' doit être ${attendu}, reçu ${typeof v}`);
  }
  if (attendu === "number" && !Number.isFinite(v)) {
    throw new ConfigError(`config: '${chemin}' doit être un nombre fini, reçu ${String(v)}`);
  }
}

export function chargerConfig(chemin: string): Balance {
  const cheminAbsolu = resolve(chemin);
  let brut: string;
  try {
    brut = readFileSync(cheminAbsolu, "utf-8");
  } catch (e) {
    const raison = e instanceof Error ? e.message : String(e);
    throw new ConfigError(`config: lecture impossible de '${cheminAbsolu}' (${raison})`);
  }
  let parse: unknown;
  try {
    parse = JSON.parse(brut);
  } catch (e) {
    const raison = e instanceof Error ? e.message : String(e);
    throw new ConfigError(`config: JSON invalide dans '${cheminAbsolu}' (${raison})`);
  }
  valider(parse, SCHEMA, "");
  return parse as Balance;
}
