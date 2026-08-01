// Batch de 20 graines : compare `pur_reactif` et `pur_prevoyant`.
// L'écart entre les deux mesure la VALEUR DE L'INFORMATION dans le jeu.
// Si l'écart est nul, le dispositif de renseignement est décoratif.

import { chargerConfig } from "../config/loader.js";
import { executerCampagne } from "./campagne.js";
import { PUR_REACTIF, PUR_PREVOYANT, type Population } from "./populations/index.js";

const NB_GRAINES = 20;
const DUREE = 30;

const config = chargerConfig("./config/balance.json");

interface AgrégéJour {
  lieux_ry: number[];
}

function batch(pop: Population): {
  parJour: AgrégéJour[];
  tenues: number;
  joursChute: number[];
} {
  const parJour: AgrégéJour[] = [];
  for (let j = 0; j < DUREE; j++) parJour.push({ lieux_ry: [] });
  const joursChute: number[] = [];
  let tenues = 0;
  for (let g = 0n; g < BigInt(NB_GRAINES); g++) {
    const res = executerCampagne({
      graine: g,
      population: pop,
      puissance_varhal: 1,
      duree_jours: DUREE,
      config,
    });
    const m = res.etat_final.metriques;
    if (m.jour_chute === null) tenues++;
    else joursChute.push(m.jour_chute);
    for (let i = 0; i < m.lieux_royaume_par_jour.length; i++) {
      parJour[i]!.lieux_ry.push(m.lieux_royaume_par_jour[i]!);
    }
  }
  return { parJour, tenues, joursChute };
}

function moyenne(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function mediane(xs: number[]): number {
  if (xs.length === 0) return 0;
  const tri = [...xs].sort((a, b) => a - b);
  const n = tri.length;
  if (n % 2 === 1) return tri[Math.floor(n / 2)]!;
  return (tri[n / 2 - 1]! + tri[n / 2]!) / 2;
}

const rea = batch(PUR_REACTIF);
const pre = batch(PUR_PREVOYANT);

console.log(`# Valeur de l'information — ${NB_GRAINES} graines, ${DUREE} jours`);
console.log(`# reactif    : ${rea.tenues}/${NB_GRAINES} tenues`);
if (rea.joursChute.length > 0) {
  console.log(
    `#             chute min J${Math.min(...rea.joursChute)}, ` +
      `médiane J${mediane(rea.joursChute)}, max J${Math.max(...rea.joursChute)}`,
  );
}
console.log(`# prévoyant  : ${pre.tenues}/${NB_GRAINES} tenues`);
if (pre.joursChute.length > 0) {
  console.log(
    `#             chute min J${Math.min(...pre.joursChute)}, ` +
      `médiane J${mediane(pre.joursChute)}, max J${Math.max(...pre.joursChute)}`,
  );
}
console.log();
console.log("jour  reactif(moy)  prevoyant(moy)  écart");
console.log("-".repeat(50));
for (let j = 0; j < DUREE; j++) {
  const r = moyenne(rea.parJour[j]!.lieux_ry);
  const p = moyenne(pre.parJour[j]!.lieux_ry);
  const ecart = p - r;
  console.log(
    `${String(j + 1).padStart(4)}  ` +
      `${r.toFixed(2).padStart(12)}  ` +
      `${p.toFixed(2).padStart(14)}  ` +
      `${(ecart >= 0 ? "+" : "") + ecart.toFixed(2)}`,
  );
}
