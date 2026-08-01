import tsparser from "@typescript-eslint/parser";

const INTERDITS_ENGINE = [
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
      "no-restricted-syntax": ["error", ...INTERDITS_ENGINE],
    },
  },
];
