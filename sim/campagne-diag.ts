// Diagnostic ciblé d'une campagne — chiffres seuls, sans interprétation.
// Utilisé pour vérifier des hypothèses sur la mécanique de la falaise.
//
// Usage : npm run campagne:diag -- --graine 42 --population melange_representatif

import { chargerConfig } from "../config/loader.js";
import { executerCampagne } from "./campagne.js";
import { POPULATIONS } from "./populations/index.js";

function parseArgs(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a.startsWith("--")) {
      const clef = a.slice(2);
      const val = argv[i + 1];
      if (val !== undefined && !val.startsWith("--")) {
        out[clef] = val;
        i++;
      } else {
        out[clef] = "true";
      }
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const graine = BigInt(args["graine"] ?? "42");
  const nomPop = args["population"] ?? "melange_representatif";
  const puissanceVarhal = parseFloat(args["varhal"] ?? "1.0");

  const population = POPULATIONS[nomPop];
  if (population === undefined) {
    console.error(`Population inconnue : ${nomPop}`);
    process.exit(1);
  }

  const config = chargerConfig("./config/balance.json");
  const res = executerCampagne({
    graine,
    population,
    puissance_varhal: puissanceVarhal,
    duree_jours: 30,
    config,
  });
  const m = res.etat_final.metriques;

  console.log(`# Diagnostic — graine ${graine}, population ${nomPop}`);
  console.log(`# Lieux royaume initial : ${m.lieux_royaume_initial}`);
  console.log();

  // --- Table 1 : jour par jour ---------------------------------------------
  console.log("## Jour par jour");
  console.log(
    "jour  lieux_ry  volume    nb_frt  vol/frt   eff_def/frt  stock_ctr  couverture",
  );
  console.log("-".repeat(80));
  for (let i = 0; i < m.lieux_royaume_par_jour.length; i++) {
    const jour = i + 1;
    const lx = m.lieux_royaume_par_jour[i]!;
    const vol = m.volume_par_jour[i] ?? 0;
    const nbf = m.nb_fronts_par_jour[i] ?? 0;
    const volParFront = nbf === 0 ? 0 : vol / nbf;
    const effDef = m.effectif_defensif_moyen_par_front_par_jour[i] ?? 0;
    const stock = m.blesses_au_centre_par_jour[i] ?? 0;
    const cv = m.couverture_par_jour[i] ?? 0;
    const cvStr = Number.isFinite(cv) ? cv.toFixed(2) : " inf ";
    console.log(
      `${String(jour).padStart(4)}  ` +
        `${String(lx).padStart(8)}  ` +
        `${vol.toFixed(1).padStart(8)}  ` +
        `${String(nbf).padStart(6)}  ` +
        `${volParFront.toFixed(1).padStart(8)}  ` +
        `${effDef.toFixed(1).padStart(10)}  ` +
        `${String(stock).padStart(9)}  ` +
        `${cvStr.padStart(10)}`,
    );
  }

  // --- Table 2 : causes de chute -------------------------------------------
  console.log();
  console.log("## Chutes par cause");
  const parCause: Record<string, number> = { assaut: 0, famine: 0, isole: 0 };
  for (const c of m.chutes) parCause[c.cause] = (parCause[c.cause] ?? 0) + 1;
  console.log(`  assaut  : ${parCause["assaut"]}`);
  console.log(`  famine  : ${parCause["famine"]}`);
  console.log(`  isolé   : ${parCause["isole"]}`);
  console.log(`  total   : ${m.chutes.length}`);

  console.log();
  console.log("## Chutes en détail (jour, lieu, cause)");
  for (const c of m.chutes) {
    console.log(`  J${String(c.jour).padStart(2)}  ${c.lieu_id}  ${c.cause}`);
  }

  // --- Table 3 : chronologie de la falaise ---------------------------------
  console.log();
  console.log("## Falaise");
  const premiere = m.chutes[0];
  if (premiere === undefined) {
    console.log("  Aucune chute sur la campagne.");
  } else {
    console.log(`  Jour de la 1ère perte      : J${premiere.jour}`);
    // Trouve le jour où lieux_royaume passe sous la moitié initiale.
    const demi = m.lieux_royaume_initial / 2;
    let jourMoitie: number | null = null;
    for (let i = 0; i < m.lieux_royaume_par_jour.length; i++) {
      if (m.lieux_royaume_par_jour[i]! < demi) {
        jourMoitie = i + 1;
        break;
      }
    }
    if (jourMoitie === null) {
      console.log(
        `  Moitié (${demi}) jamais atteinte sur ${m.lieux_royaume_par_jour.length} jours`,
      );
    } else {
      console.log(`  Jour où lieux < ${demi}       : J${jourMoitie}`);
      console.log(`  Délai 1ère perte → moitié   : ${jourMoitie - premiere.jour} jours`);
    }
  }
}

main();
