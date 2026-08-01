export type { Politique, NomPolitique, EntreePolitique } from "./types.js";
export { assidu } from "./assidu.js";
export { irregulier } from "./irregulier.js";
export { egoiste } from "./egoiste.js";
export { deserteur } from "./deserteur.js";

import type { NomPolitique, Politique } from "./types.js";
import { assidu } from "./assidu.js";
import { irregulier } from "./irregulier.js";
import { egoiste } from "./egoiste.js";
import { deserteur } from "./deserteur.js";

export const POLITIQUES: Readonly<Record<NomPolitique, Politique>> = {
  assidu,
  irregulier,
  egoiste,
  deserteur,
};
