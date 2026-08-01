import tsparser from "@typescript-eslint/parser";

const INTERDITS_ENGINE_COMMUNS = [
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message:
      "/engine ne doit jamais appeler Date.now(). L'instant courant est un paramètre explicite (CLAUDE.md).",
  },
  {
    selector: "NewExpression[callee.name='Date']",
    message:
      "/engine ne doit jamais utiliser new Date(). L'instant courant est un paramètre explicite (CLAUDE.md).",
  },
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message:
      "/engine ne peut pas utiliser Math.random(). Passe par /engine/rng avec une graine explicite (RULES §6).",
  },
];

// Puissances : Math.pow et l'opérateur ** ne sont pas spécifiés au dernier bit
// par ECMAScript. Interdits dans /engine hors du module /engine/math, qui isole
// les exceptions documentées (voir engine/math/index.ts).
const INTERDITS_PUISSANCE = [
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='pow']",
    message:
      "/engine ne doit pas utiliser Math.pow (dernier bit non spécifié). Utilise engine/math/puissanceEntiere pour un exposant entier, ou puissanceCapacite pour l'exception documentée.",
  },
  {
    selector: "BinaryExpression[operator='**']",
    message:
      "/engine ne doit pas utiliser l'opérateur ** (dernier bit non spécifié). Utilise engine/math/puissanceEntiere.",
  },
  {
    selector: "AssignmentExpression[operator='**=']",
    message: "/engine ne doit pas utiliser l'opérateur **=. Voir engine/math/puissanceEntiere.",
  },
];

export default [
  {
    ignores: ["node_modules/**", "dist/**", "coverage/**", "config/.test-tmp/**"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: "module",
      },
    },
    rules: {},
  },
  {
    files: ["engine/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...INTERDITS_ENGINE_COMMUNS, ...INTERDITS_PUISSANCE],
    },
  },
  {
    // Module dédié aux exceptions documentées d'arithmétique.
    files: ["engine/math/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...INTERDITS_ENGINE_COMMUNS],
    },
  },
];
