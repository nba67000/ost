// Résolution d'un ASSAUT complet — enchaînement de rounds jusqu'à la fin.
// Implémente RULES §6 (arrêt, réserve) et §10 (blessures) et §5 (usure).
// Fonction pure : ne fait que composer resoudreRound.

import type { Balance } from "../../config/schema.js";
import type { AbordId } from "../types/carte.js";
import type { TypeForge } from "../types/forge.js";
import type { ConditionReserve } from "../types/ordre.js";
import { resoudreRound, type EtatRound, type JournalRound } from "./round.js";

export type IssueAssaut = "lieu_tombe" | "assaut_repousse" | "rounds_max_atteints";
export type Severite = "legere" | "serieuse" | "grave";

export interface EntreeAssaut {
  readonly etat_initial: EtatRound;
  /** Composition de la vague par round (1-based) et par abord. */
  readonly vagues_par_round: ReadonlyMap<
    number,
    ReadonlyMap<AbordId, Readonly<Record<TypeForge, number>>>
  >;
  readonly conditions_reserve: readonly ConditionReserve[];
  readonly config: Balance;
}

export interface Blessure {
  readonly abord_id: AbordId;
  readonly severite: Severite;
}

export interface UsureAbord {
  readonly abord_id: AbordId;
  /** 0 si aucun combat effectif ; par_assaut sinon ; +penalite si abord rompu. */
  readonly cout: number;
}

export interface SortieAssaut {
  readonly etat_final: EtatRound;
  readonly rounds: readonly JournalRound[];
  readonly blessures: readonly Blessure[];
  readonly usure: readonly UsureAbord[];
  readonly issue: IssueAssaut;
  readonly rounds_utilises: number;
}

/**
 * Sévérité à partir du ratio F_a / F_d au moment de la rupture (RULES §10).
 * Bornes incluses : ratio = 1.5 → sérieuse ; ratio = 3.0 → sérieuse.
 */
export function severite(ratio: number, config: Balance): Severite {
  const seuils = config.blessures.seuils_severite;
  if (ratio < seuils.serieuse) return "legere";
  if (ratio <= seuils.grave) return "serieuse";
  return "grave";
}

export function resoudreAssaut(entree: EntreeAssaut): SortieAssaut {
  const { etat_initial, vagues_par_round, conditions_reserve, config } = entree;
  const rounds_max = config.combat.rounds_max;

  let etat = etat_initial;
  const journaux: JournalRound[] = [];
  const pertesDefParAbord = new Map<AbordId, number>();
  const combatEffectifParAbord = new Set<AbordId>();
  const ratioARupture = new Map<AbordId, number>();

  let issue: IssueAssaut = "rounds_max_atteints";
  let rounds_utilises = 0;

  for (let r = 1; r <= rounds_max; r++) {
    const wave = vagues_par_round.get(r) ?? new Map<AbordId, Record<TypeForge, number>>();
    const waveSum = sommeVague(wave);
    const futureSum = sommeVaguesRestantes(vagues_par_round, r + 1, rounds_max);

    // Effectif assaillant nul : aucune vague ce round ET aucune vague future.
    if (waveSum === 0 && futureSum === 0) {
      issue = "assaut_repousse";
      break;
    }

    const s = resoudreRound({
      etat,
      vagues: wave,
      conditions_reserve,
      config,
    });
    journaux.push(s.journal);
    rounds_utilises = r;

    for (const d of s.journal.details_abords) {
      const prev = pertesDefParAbord.get(d.abord_id) ?? 0;
      pertesDefParAbord.set(d.abord_id, prev + d.pertes_defenseur);
      if (d.force_defenseur > 0 && d.force_assaillant > 0) {
        combatEffectifParAbord.add(d.abord_id);
      }
      if (d.rupture && !d.cede_sans_combat) {
        const ratio =
          d.force_defenseur > 0 ? d.force_assaillant / d.force_defenseur : Number.POSITIVE_INFINITY;
        ratioARupture.set(d.abord_id, ratio);
      }
    }

    etat = s.etat_apres;

    if (s.journal.lieu_tombe) {
      issue = "lieu_tombe";
      break;
    }
  }

  // Blessures : uniquement depuis les abords ayant CÉDÉ, à hauteur de
  // part_des_pertes × pertes_defenseur cumulées. Sévérité déterminée au
  // moment de la rupture. Un abord cédé sans combat ne produit pas de
  // blessés (personne à blesser).
  const blessures: Blessure[] = [];
  for (const abord of etat.abords) {
    if (!abord.rompu) continue;
    const ratio = ratioARupture.get(abord.abord_id);
    if (ratio === undefined) continue;
    const sev = severite(ratio, config);
    const pertesTotal = pertesDefParAbord.get(abord.abord_id) ?? 0;
    const nb = Math.floor(config.blessures.part_des_pertes * pertesTotal);
    for (let i = 0; i < nb; i++) {
      blessures.push({ abord_id: abord.abord_id, severite: sev });
    }
  }

  // Usure : par_assaut si un combat effectif a eu lieu ; +penalite_abord_rompu
  // si l'abord a cédé. 0 sinon.
  const usure: UsureAbord[] = etat.abords.map((a) => {
    if (!combatEffectifParAbord.has(a.abord_id)) {
      return { abord_id: a.abord_id, cout: 0 };
    }
    const cout = config.usure.par_assaut + (a.rompu ? config.usure.penalite_abord_rompu : 0);
    return { abord_id: a.abord_id, cout };
  });

  return {
    etat_final: etat,
    rounds: journaux,
    blessures,
    usure,
    issue,
    rounds_utilises,
  };
}

// --- Helpers internes ------------------------------------------------------

function sommeVague(v: ReadonlyMap<AbordId, Readonly<Record<TypeForge, number>>>): number {
  let s = 0;
  for (const comp of v.values()) {
    for (const c of Object.values(comp)) s += c;
  }
  return s;
}

function sommeVaguesRestantes(
  vagues_par_round: ReadonlyMap<number, ReadonlyMap<AbordId, Readonly<Record<TypeForge, number>>>>,
  from_round: number,
  rounds_max: number,
): number {
  let s = 0;
  for (let r = from_round; r <= rounds_max; r++) {
    const w = vagues_par_round.get(r);
    if (w !== undefined) s += sommeVague(w);
  }
  return s;
}
