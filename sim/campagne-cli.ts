// CLI de campagne — exécute une simulation et imprime le rapport.
// Usage : npm run campagne -- --graine 42 --population melange_representatif
//         [--varhal 1.0] [--jours 30]

import { chargerConfig } from "../config/loader.js";
import { executerCampagne } from "./campagne.js";
import { POPULATIONS } from "./populations/index.js";
import { rendreTexte, synthetiser } from "./rapport.js";

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
  const dureeJours = parseInt(args["jours"] ?? "30", 10);

  const population = POPULATIONS[nomPop];
  if (population === undefined) {
    console.error(`Population inconnue : ${nomPop}`);
    console.error(`Populations disponibles : ${Object.keys(POPULATIONS).join(", ")}`);
    process.exit(1);
  }

  const config = chargerConfig("./config/balance.json");
  const res = executerCampagne({
    graine,
    population,
    puissance_varhal: puissanceVarhal,
    duree_jours: dureeJours,
    config,
  });
  const rapport = synthetiser(res);
  console.log(rendreTexte(rapport));
}

main();
