// Formatage du rapport de campagne pour la console.
// Livre les métriques dans l'ordre demandé (voir docs DECISIONS).

import type { ResultatCampagne } from "./campagne.js";
import type { NomDoctrine } from "../engine/horde/doctrines/index.js";

const NOMS_LISIBLES: Readonly<Record<NomDoctrine, string>> = {
  marteau: "Marteau",
  ecorcheurs: "Écorcheurs",
  meute: "Meute",
  rouleau: "Rouleau",
  garde: "Garde",
  serpent: "Serpent",
};

/**
 * Chiffres bruts de la campagne, structure stable — sert de source aux
 * snapshots Vitest et au rendu console.
 */
export interface RapportCampagne {
  readonly resultat: "tenue" | "tombee";
  readonly jour_chute: number | null;
  readonly lieux_tenus_fin_acte: {
    readonly acte_1: number;
    readonly acte_2: number;
    readonly acte_3: number;
  };
  readonly blesses_au_centre: {
    readonly moyenne: number;
    readonly minimum: number;
    readonly maximum: number;
  };
  readonly blesses_au_centre_serie: readonly number[];
  readonly blessures_totales: {
    readonly legere: number;
    readonly serieuse: number;
    readonly grave: number;
  };
  readonly usure_consommee: number;
  readonly equipements_detruits: number;
  readonly doctrines_actives: readonly NomDoctrine[];
  readonly premier_choix: readonly { doctrine: NomDoctrine; taux: number; tours: number }[];
}

export function synthetiser(res: ResultatCampagne): RapportCampagne {
  const m = res.etat_final.metriques;
  const jours = m.lieux_royaume_par_jour;
  const acte1 = jours[9] ?? jours[jours.length - 1] ?? 0;
  const acte2 = jours[19] ?? jours[jours.length - 1] ?? 0;
  const acte3 = jours[29] ?? jours[jours.length - 1] ?? 0;

  const bc = m.blesses_au_centre_par_jour;
  const moyenne = bc.length === 0 ? 0 : bc.reduce((a, b) => a + b, 0) / bc.length;
  const minimum = bc.length === 0 ? 0 : Math.min(...bc);
  const maximum = bc.length === 0 ? 0 : Math.max(...bc);

  const premierChoix: RapportCampagne["premier_choix"] = res.etat_final.doctrines_actives.map(
    (d) => {
      const stats = m.premier_choix_par_doctrine[d];
      const taux = stats.draft_tours === 0 ? 0 : stats.premier_choix_obtenus / stats.draft_tours;
      return { doctrine: d, taux, tours: stats.draft_tours };
    },
  );

  return {
    resultat: res.province_est_tombee ? "tombee" : "tenue",
    jour_chute: m.jour_chute,
    lieux_tenus_fin_acte: { acte_1: acte1, acte_2: acte2, acte_3: acte3 },
    blesses_au_centre: { moyenne, minimum, maximum },
    blesses_au_centre_serie: bc,
    blessures_totales: m.blessures_totales,
    usure_consommee: m.usure_consommee,
    equipements_detruits: m.equipements_detruits,
    doctrines_actives: res.etat_final.doctrines_actives,
    premier_choix: premierChoix,
  };
}

export function rendreTexte(r: RapportCampagne): string {
  const lignes: string[] = [];
  lignes.push("Campagne — synthèse");
  lignes.push("-".repeat(60));
  if (r.resultat === "tenue") {
    lignes.push("Résultat            : province TENUE (aucune chute sur 30 jours)");
  } else {
    lignes.push(`Résultat            : province TOMBÉE au jour ${r.jour_chute}`);
  }
  lignes.push(
    `Lieux tenus         : acte 1 = ${r.lieux_tenus_fin_acte.acte_1}  |  ` +
      `acte 2 = ${r.lieux_tenus_fin_acte.acte_2}  |  ` +
      `acte 3 = ${r.lieux_tenus_fin_acte.acte_3}`,
  );
  lignes.push(
    `Blessés au centre   : moyenne ${r.blesses_au_centre.moyenne.toFixed(1)}, ` +
      `minimum ${r.blesses_au_centre.minimum}, pic ${r.blesses_au_centre.maximum}`,
  );
  lignes.push(
    `Blessures totales   : ${r.blessures_totales.legere + r.blessures_totales.serieuse + r.blessures_totales.grave} ` +
      `(légères ${r.blessures_totales.legere}, sérieuses ${r.blessures_totales.serieuse}, ` +
      `graves ${r.blessures_totales.grave})`,
  );
  lignes.push(
    `Usure consommée     : ${r.usure_consommee}  |  équipements détruits : ${r.equipements_detruits}`,
  );
  lignes.push(
    `Doctrines actives   : ${r.doctrines_actives.map((d) => NOMS_LISIBLES[d]).join(", ")}`,
  );
  lignes.push("Premier choix       :");
  for (const pc of r.premier_choix) {
    const pct = (pc.taux * 100).toFixed(0);
    const alerte =
      pc.taux < 0.5 && pc.tours >= 5 ? "  ← alerte : sous seuil de reconnaissance" : "";
    lignes.push(
      `  ${NOMS_LISIBLES[pc.doctrine].padEnd(12)} ${pct.padStart(3)} %  (${pc.tours} jours ordinaires)${alerte}`,
    );
  }
  return lignes.join("\n");
}
