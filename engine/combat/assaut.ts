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

export interface UsureAbord {
  readonly abord_id: AbordId;
  /** 0 si aucun combat effectif ; par_assaut sinon ; +penalite si abord rompu. */
  readonly cout: number;
}

/**
 * Détail par abord des conditions qui déterminent qui est blessé.
 * Le CALCUL du nombre de joueurs blessés a lieu à l'étage supérieur
 * (`engine/jour/consequences.ts`) qui connaît la composition des paquets :
 * les blessures s'expriment en probabilité PAR JOUEUR ENGAGÉ, pas comme
 * une fraction des effectifs perdus.
 */
export interface DetailBlessuresAbord {
  readonly abord_id: AbordId;
  /** Vrai si l'abord a subi au moins un round avec pertes_defenseur > 0. */
  readonly a_subi_des_pertes: boolean;
  /** Vrai si l'abord a cédé (rupture). */
  readonly rompu: boolean;
  /**
   * Sévérité applicable aux joueurs blessés à cet abord si `rompu = true`.
   * Dérivée du ratio F_a / F_d au moment de la rupture (RULES §10).
   * Null si l'abord est tenu — dans ce cas la sévérité est légère par défaut.
   */
  readonly severite_si_rompu: Severite | null;
}

export interface SortieAssaut {
  readonly etat_final: EtatRound;
  readonly rounds: readonly JournalRound[];
  readonly details_blessures: readonly DetailBlessuresAbord[];
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

  // Détails par abord : la traduction pertes → joueurs blessés se fait à
  // l'étage supérieur. Ici on expose seulement les CONDITIONS (a subi des
  // pertes, rompu, sévérité à la rupture). RULES §10 : toute perte du
  // défenseur produit des blessés, avec deux régimes selon si l'abord tient
  // ou cède. Un abord cédé sans combat n'a pas de pertes et pas de blessés.
  const detailsBlessures: DetailBlessuresAbord[] = etat.abords.map((abord) => {
    const pertes = pertesDefParAbord.get(abord.abord_id) ?? 0;
    const aSubiDesPertes = pertes > 0;
    const rompu = abord.rompu;
    const ratio = ratioARupture.get(abord.abord_id);
    const severiteSiRompu = rompu && ratio !== undefined ? severite(ratio, config) : null;
    return {
      abord_id: abord.abord_id,
      a_subi_des_pertes: aSubiDesPertes,
      rompu,
      severite_si_rompu: severiteSiRompu,
    };
  });

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
    details_blessures: detailsBlessures,
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
