import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { chargerConfig, ConfigError } from "./loader.js";

const TMP_DIR = resolve("./config/.test-tmp");
const REEL = "./config/balance.json";

function ecrireTemp(nom: string, contenu: unknown): string {
  mkdirSync(TMP_DIR, { recursive: true });
  const chemin = resolve(TMP_DIR, nom);
  writeFileSync(chemin, JSON.stringify(contenu, null, 2), "utf-8");
  return chemin;
}

function chargerCopie(): Record<string, unknown> {
  return JSON.parse(readFileSync(REEL, "utf-8")) as Record<string, unknown>;
}

afterAll(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("chargerConfig", () => {
  it("charge le vrai balance.json et lit des valeurs clés", () => {
    const cfg = chargerConfig(REEL);
    expect(cfg.combat.taux_pertes_par_round).toBe(0.35);
    expect(cfg.grades.seuils_effectif.sergent).toBe(15);
    expect(cfg.horde.doctrines_total).toBe(6);
  });

  it("jette avec le chemin exact d'une clé manquante en profondeur", () => {
    const cfg = chargerCopie();
    delete (cfg.combat as Record<string, unknown>).taux_pertes_par_round;
    const chemin = ecrireTemp("balance.ampute.json", cfg);
    expect(() => chargerConfig(chemin)).toThrow(ConfigError);
    expect(() => chargerConfig(chemin)).toThrow(/combat\.taux_pertes_par_round/);
  });

  it("jette pour une section entière manquante", () => {
    const cfg = chargerCopie();
    delete cfg.horde;
    const chemin = ecrireTemp("balance.sans-horde.json", cfg);
    expect(() => chargerConfig(chemin)).toThrow(/horde/);
  });

  it("jette pour un type incorrect avec le chemin", () => {
    const cfg = chargerCopie();
    (cfg.combat as Record<string, unknown>).rounds_max = "cinq";
    const chemin = ecrireTemp("balance.mauvais-type.json", cfg);
    expect(() => chargerConfig(chemin)).toThrow(/combat\.rounds_max.*number/);
  });

  it("jette pour un nombre non fini (NaN)", () => {
    // JSON.stringify convertit NaN en null, donc on doit trafiquer le texte
    const chemin = ecrireTemp("balance.nan.json", chargerCopie());
    const brut = readFileSync(chemin, "utf-8").replace('"rounds_max": 5', '"rounds_max": null');
    writeFileSync(chemin, brut, "utf-8");
    expect(() => chargerConfig(chemin)).toThrow(/combat\.rounds_max/);
  });

  it("jette lisiblement si le fichier n'existe pas", () => {
    expect(() => chargerConfig("./config/n-existe-pas.json")).toThrow(ConfigError);
    expect(() => chargerConfig("./config/n-existe-pas.json")).toThrow(/lecture impossible/);
  });
});
