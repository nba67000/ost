// npm run sim — charge la config et l'affiche. Rien de plus pour l'instant.

import { chargerConfig } from "../config/loader.js";

const config = chargerConfig("./config/balance.json");
process.stdout.write(JSON.stringify(config, null, 2) + "\n");
