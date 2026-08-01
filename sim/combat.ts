// npm run combat -- --scenario <fichier.json>
// Rejoue un assaut décrit dans un fichier, imprime le journal round par round,
// puis un résumé (blessures par sévérité, usure par abord, issue).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chargerConfig } from "../config/loader.js";
import { resoudreAssaut, type SortieAssaut } from "../engine/combat/assaut.js";
import { type EtatAbord, type EtatRound, type JournalRound } from "../engine/combat/round.js";
import type { AbordId, LieuId } from "../engine/types/carte.js";
import type { TypeForge } from "../engine/types/forge.js";
import type { Posture } from "../engine/types/garnison.js";
import type { Grade } from "../engine/types/grade.js";
import type { ConditionReserve } from "../engine/types/ordre.js";

function arg(nom: string): string | undefined {
  const idx = process.argv.indexOf(`--${nom}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

function erreur(msg: string): never {
  process.stderr.write(msg + "\n");
  process.exit(1);
}

interface ScenarioAbord {
  abord_id: string;
  effectif: number;
  effectif_initial_assaut?: number;
  posture: Exclude<Posture, "reserve">;
  voisins: string[];
  fortification_niveau: number;
  terrain_fortification: number;
  ravitaillement_coef: number;
  fatigue_coef: number;
  usure_coef: number;
  preparation_coef: number;
  commandant_grade: Grade;
}

interface ScenarioReserve {
  effectif: number;
  effectif_initial_assaut?: number;
  commandant_grade: Grade;
}

interface ScenarioVaguesRound {
  round: number;
  vagues: Record<string, Partial<Record<TypeForge, number>>>;
}

interface Scenario {
  lieu_id: string;
  abords: ScenarioAbord[];
  reserve: ScenarioReserve;
  conditions_reserve: ConditionReserve[];
  vagues_par_round: ScenarioVaguesRound[];
}

function normaliserComposition(
  partial: Partial<Record<TypeForge, number>>,
): Record<TypeForge, number> {
  return {
    souche: partial.souche ?? 0,
    ecorcheur: partial.ecorcheur ?? 0,
    belier: partial.belier ?? 0,
    chien_de_fosse: partial.chien_de_fosse ?? 0,
    muet: partial.muet ?? 0,
  };
}

function sommeCompositionAff(c: Record<TypeForge, number>): string {
  const parts: string[] = [];
  for (const t of ["souche", "ecorcheur", "belier", "chien_de_fosse", "muet"] as TypeForge[]) {
    if (c[t] > 0) parts.push(`${c[t]} ${t}`);
  }
  return parts.join(" + ") || "vide";
}

function nombre(v: number, d = 1): string {
  return v.toFixed(d);
}

function imprimerEntete(scen: Scenario, etat0: EtatRound): void {
  const out: string[] = [];
  out.push(
    `Assaut sur ${scen.lieu_id} — commandant ${scen.reserve.commandant_grade}, ` +
      `${scen.abords.length} abord${scen.abords.length > 1 ? "s" : ""}, ` +
      `réserve initiale ${scen.reserve.effectif}`,
  );
  out.push("État initial :");
  for (const a of etat0.abords) {
    out.push(
      `  ${a.abord_id.padEnd(10)} eff ${String(a.effectif).padStart(3)}   posture ${a.posture.padEnd(6)}   ` +
        `fortif ${a.fortification_niveau}   voisins [${a.voisins.join(", ") || "aucun"}]`,
    );
  }
  process.stdout.write(out.join("\n") + "\n\n");
}

function imprimerRound(
  journal: JournalRound,
  vagues: Map<AbordId, Record<TypeForge, number>>,
): void {
  const out: string[] = [];
  out.push(`Round ${journal.numero_round}`);
  for (const d of journal.details_abords) {
    const comp = vagues.get(d.abord_id);
    const compStr = comp ? sommeCompositionAff(comp) : "—";
    const flanque = d.flanque_ce_round ? " [flanqué]" : "";
    if (d.cede_sans_combat) {
      out.push(
        `  ${d.abord_id.padEnd(10)} CÉDÉ SANS COMBAT (garnison nulle), assaillant ${d.force_assaillant}${flanque}`,
      );
      continue;
    }
    if (d.force_defenseur === 0 && d.force_assaillant === 0) {
      out.push(`  ${d.abord_id.padEnd(10)} pas d'assaut${flanque}`);
      continue;
    }
    const rupture = d.rupture ? "  RUPTURE" : "";
    out.push(
      `  ${d.abord_id.padEnd(10)} ` +
        `eff ${String(d.effectif_avant).padStart(3)}→${String(d.effectif_apres).padStart(3)}  ` +
        `F_def ${nombre(d.force_defenseur).padStart(6)} (posture ${nombre(d.coef_posture, 2)}) ` +
        `vs F_ass ${nombre(d.force_assaillant, 0).padStart(4)} (${compStr})  ` +
        `pertes ${String(d.pertes_defenseur).padStart(2)}/${String(d.pertes_assaillant).padStart(2)}` +
        `${flanque}${rupture}`,
    );
  }
  for (const e of journal.engagements_reserve) {
    out.push(
      `  Réserve : condition #${e.condition_ordre} → engage ${e.effectif_engage} sur ${e.abord_cible}`,
    );
  }
  if (journal.lieu_tombe) {
    out.push(`  → Lieu tombé.`);
  }
  process.stdout.write(out.join("\n") + "\n\n");
}

function imprimerResume(sortie: SortieAssaut): void {
  const out: string[] = [];
  const issueTexte =
    sortie.issue === "lieu_tombe"
      ? `Lieu tombé au round ${sortie.rounds_utilises}.`
      : sortie.issue === "assaut_repousse"
        ? `Assaut repoussé (${sortie.rounds_utilises} round${sortie.rounds_utilises > 1 ? "s" : ""}).`
        : `Rounds max atteints (${sortie.rounds_utilises}), défenseur tient.`;
  out.push(`Issue : ${issueTexte}`);

  // Blessures
  const par_sev = { legere: 0, serieuse: 0, grave: 0 };
  for (const b of sortie.blessures) par_sev[b.severite]++;
  out.push(
    `Blessures : ${sortie.blessures.length} au total ` +
      `(légères ${par_sev.legere}, sérieuses ${par_sev.serieuse}, graves ${par_sev.grave})`,
  );
  if (sortie.blessures.length > 0) {
    const par_abord = new Map<string, number>();
    for (const b of sortie.blessures) {
      par_abord.set(b.abord_id, (par_abord.get(b.abord_id) ?? 0) + 1);
    }
    for (const [id, n] of par_abord) {
      out.push(`  ${id.padEnd(10)} ${n} blessé${n > 1 ? "s" : ""}`);
    }
  }

  // Usure
  const usure_pertinente = sortie.usure.filter((u) => u.cout > 0);
  if (usure_pertinente.length > 0) {
    out.push(`Usure par abord (coût par pièce engagée) :`);
    for (const u of usure_pertinente) {
      out.push(`  ${u.abord_id.padEnd(10)} +${u.cout}`);
    }
  } else {
    out.push(`Usure : aucun combat effectif.`);
  }

  process.stdout.write(out.join("\n") + "\n");
}

// --- Main ---------------------------------------------------------------

const scenPath = arg("scenario");
if (scenPath === undefined) {
  erreur("Usage : npm run combat -- --scenario <fichier.json>");
}

const cheminAbs = resolve(scenPath);
let raw: string;
try {
  raw = readFileSync(cheminAbs, "utf-8");
} catch (e) {
  erreur(`Lecture impossible de '${cheminAbs}' : ${(e as Error).message}`);
}

let scen: Scenario;
try {
  scen = JSON.parse(raw) as Scenario;
} catch (e) {
  erreur(`JSON invalide : ${(e as Error).message}`);
}

const config = chargerConfig("./config/balance.json");

const abords0: EtatAbord[] = scen.abords.map((a) => ({
  abord_id: a.abord_id as AbordId,
  effectif: a.effectif,
  effectif_initial_assaut: a.effectif_initial_assaut ?? a.effectif,
  posture: a.posture,
  voisins: a.voisins.map((v) => v as AbordId),
  fortification_niveau: a.fortification_niveau,
  terrain_fortification: a.terrain_fortification,
  ravitaillement_coef: a.ravitaillement_coef,
  fatigue_coef: a.fatigue_coef,
  usure_coef: a.usure_coef,
  preparation_coef: a.preparation_coef,
  commandant_grade: a.commandant_grade,
  rompu: false,
  flanque_ce_round: false,
  reserve_recente: false,
}));

const etat_initial: EtatRound = {
  lieu_id: scen.lieu_id as LieuId,
  numero_round: 1,
  abords: abords0,
  reserve: {
    effectif: scen.reserve.effectif,
    effectif_initial_assaut: scen.reserve.effectif_initial_assaut ?? scen.reserve.effectif,
    commandant_grade: scen.reserve.commandant_grade,
  },
};

const vagues_par_round = new Map<number, Map<AbordId, Record<TypeForge, number>>>();
for (const vr of scen.vagues_par_round) {
  const m = new Map<AbordId, Record<TypeForge, number>>();
  for (const [id, comp] of Object.entries(vr.vagues)) {
    m.set(id as AbordId, normaliserComposition(comp));
  }
  vagues_par_round.set(vr.round, m);
}

imprimerEntete(scen, etat_initial);

const sortie = resoudreAssaut({
  etat_initial,
  vagues_par_round,
  conditions_reserve: scen.conditions_reserve,
  config,
});

for (let i = 0; i < sortie.rounds.length; i++) {
  const journal = sortie.rounds[i]!;
  const wave = vagues_par_round.get(journal.numero_round) ?? new Map();
  imprimerRound(journal, wave);
}

imprimerResume(sortie);
