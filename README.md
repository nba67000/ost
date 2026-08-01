# L'Ost

Jeu de stratégie asynchrone, navigateur, coopératif. Développé en solo.
Règles et vocabulaire : `docs/RULES.md`, `docs/GLOSSARY.md`, `docs/DECISIONS.md`.

## Prérequis

Node.js >= 22.

## Commandes

```
npm install                                      # une fois
npm test                                         # tests unitaires
npm run sim                                      # charge la config et l'affiche
npm run carte -- --graine 42 --joueurs 25        # génère une carte lisible
npm run carte:stats -- --tirages 100             # distribution multi-populations
```
