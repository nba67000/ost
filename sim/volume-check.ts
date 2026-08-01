// Diagnostic hors-ligne du calibrage horde.
// Affiche pour 5 tailles de population, le volume calculé par calculerVolume
// et vérifie la sous-linéarité : le volume par joueur doit décroître, et le
// plafond ne doit mordre qu'aux petites tailles.

import { chargerConfig } from "../config/loader.js";
import { calculerVolume } from "../engine/horde/volume.js";

const config = chargerConfig("./config/balance.json");
// Nombre de fosses supposé pour le diagnostic. À la génération, les cartes
// tirent entre generation.fosses_min et generation.fosses_max — 2 est la
// valeur milieu de tirage.
const NB_FOSSES_MOYEN = 2;
const productionCumulee = NB_FOSSES_MOYEN * config.horde.production_par_fosse_par_jour;

const populations = [50, 100, 286, 500, 1000];

console.log("Calibrage horde — volume par jour ordinaire");
console.log(
  `Config : pression_base=${config.horde.pression_base}, ` +
    `production_par_fosse=${config.horde.production_par_fosse_par_jour}, ` +
    `plancher_coef=${config.horde.plancher_coef}, plafond_coef=${config.horde.plafond_coef}`,
);
console.log(`Hypothèse : nb_fosses=${NB_FOSSES_MOYEN} (production_cumulee=${productionCumulee})`);
console.log();
console.log("pop     brut       volume    plancher  plafond   clamp    v/pop");
console.log("-".repeat(72));

for (const pop of populations) {
  const brut = config.horde.pression_base * productionCumulee * Math.pow(pop, 0.7);
  const plancher = config.horde.plancher_coef * pop;
  const plafond = config.horde.plafond_coef * pop;
  const volume = calculerVolume({
    production_cumulee_fosses: productionCumulee,
    puissance_varhal: 1,
    effectif_total_royaume: pop,
    config,
  });
  let clamp = "-";
  if (volume === plafond) clamp = "PLAFOND";
  else if (volume === plancher) clamp = "PLANCHER";
  console.log(
    `${String(pop).padStart(4)}  ` +
      `${brut.toFixed(1).padStart(9)}  ` +
      `${volume.toFixed(1).padStart(8)}  ` +
      `${plancher.toFixed(1).padStart(8)}  ` +
      `${plafond.toFixed(1).padStart(8)}  ` +
      `${clamp.padEnd(7)}  ` +
      `${(volume / pop).toFixed(3)}`,
  );
}
