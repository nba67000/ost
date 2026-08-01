// Batch de 20 graines sur la population `pur_concentrateur`.
// Mesure le plafond défensif face au calibrage actuel de la horde.
//
// Sortie : par jour (moyenne sur les campagnes encore vivantes)
//   - lieux tenus royaume
//   - volume total
//   - volume par front
//   - effectif défensif moyen par front
// Plus : nombre de campagnes tenant les 30 jours, jour médian de chute.

import { chargerConfig } from "../config/loader.js";
import { executerCampagne } from "./campagne.js";
import { PUR_CONCENTRATEUR } from "./populations/index.js";

const NB_GRAINES = 20;
const DUREE = 30;

const config = chargerConfig("./config/balance.json");

interface ResumeJour {
  lieux_ry: number[];
  vol: number[];
  vol_par_front: number[];
  eff_def: number[];
}

const parJour: ResumeJour[] = [];
for (let j = 0; j < DUREE; j++) {
  parJour.push({ lieux_ry: [], vol: [], vol_par_front: [], eff_def: [] });
}

const joursChute: number[] = [];
let tenues = 0;

for (let g = 0n; g < BigInt(NB_GRAINES); g++) {
  const res = executerCampagne({
    graine: g,
    population: PUR_CONCENTRATEUR,
    puissance_varhal: 1,
    duree_jours: DUREE,
    config,
  });
  const m = res.etat_final.metriques;
  if (m.jour_chute === null) tenues++;
  else joursChute.push(m.jour_chute);

  // Enregistre chaque jour où la campagne était vivante.
  for (let i = 0; i < m.lieux_royaume_par_jour.length; i++) {
    parJour[i]!.lieux_ry.push(m.lieux_royaume_par_jour[i]!);
    parJour[i]!.vol.push(m.volume_par_jour[i] ?? 0);
    const nbf = m.nb_fronts_par_jour[i] ?? 0;
    const vol = m.volume_par_jour[i] ?? 0;
    parJour[i]!.vol_par_front.push(nbf === 0 ? 0 : vol / nbf);
    parJour[i]!.eff_def.push(m.effectif_defensif_moyen_par_front_par_jour[i] ?? 0);
  }
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

console.log(`# Plafond défense — ${NB_GRAINES} graines, population pur_concentrateur`);
console.log(`# ${tenues}/${NB_GRAINES} campagnes tenues sur ${DUREE} jours`);
if (joursChute.length > 0) {
  console.log(
    `# Chute — min J${Math.min(...joursChute)}, médian J${mediane(joursChute)}, max J${Math.max(...joursChute)}`,
  );
}
console.log();
console.log("jour  campagnes  lieux_ry(moy)  vol(moy)   vol/frt(moy)  eff_def/frt(moy)");
console.log("-".repeat(80));
for (let j = 0; j < DUREE; j++) {
  const bloc = parJour[j]!;
  const n = bloc.lieux_ry.length;
  console.log(
    `${String(j + 1).padStart(4)}  ` +
      `${String(n).padStart(9)}  ` +
      `${moyenne(bloc.lieux_ry).toFixed(1).padStart(13)}  ` +
      `${moyenne(bloc.vol).toFixed(1).padStart(8)}  ` +
      `${moyenne(bloc.vol_par_front).toFixed(1).padStart(12)}  ` +
      `${moyenne(bloc.eff_def).toFixed(1).padStart(16)}`,
  );
}
