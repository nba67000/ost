# L'Ost — instructions de dépôt

Jeu de stratégie asynchrone, navigateur, coopératif. Développé en solo.

## Documents de référence

- `docs/RULES.md` — **source de vérité** des règles et de l'équilibrage. En cas de
  divergence avec le code, c'est le code qui a tort.
- `docs/GLOSSARY.md` — vocabulaire du domaine.
- `docs/DECISIONS.md` — journal des arbitrages de conception et de leurs raisons.
- `ROADMAP.md` — ordre de construction et critères de sortie de chaque phase.

Avant d'implémenter une règle, lire la section correspondante de `RULES.md`. Ne jamais
inventer une formule ou une constante : si elle manque, le signaler plutôt que de la
combler.

## Langue

Le domaine est en **français** et ne se traduit jamais. Les identifiants reprennent les
termes du glossaire en `snake_case` sans accents : `feu_de_guet`, `place_forte`,
`marcheur`, `chien_de_fosse`.

Le code technique (variables locales, utilitaires, noms de bibliothèques) reste en anglais.
Les commentaires et la documentation sont en français.

## Architecture

```
/engine      TypeScript pur — aucune I/O, aucune base, aucun réseau
/db          schéma, migrations, accès
/worker      ordonnanceur d'événements
/web         Next.js
/sim         exécuteur de campagnes, politiques de robots, rapports
/config      constantes d'équilibrage versionnées
/docs        RULES, GLOSSARY, DECISIONS
```

## Règles non négociables

**`/engine` reste pur.** Aucun effet de bord, aucun accès à la base, aucun appel réseau,
**aucun `Date.now()`** : l'instant courant est toujours un paramètre explicite. C'est ce
qui rend la simulation reproductible et le refactoring sûr.

**Aucune constante d'équilibrage en dur.** Tout passe par `/config`. Un nombre magique dans
`/engine` est un bug.

**Aucun aléatoire dans la résolution de combat.** Le combat est entièrement déterministe :
mêmes entrées, même sortie, toujours. L'incertitude vient de ce que le joueur ignore, pas
de dés. L'aléatoire est autorisé uniquement dans la génération de carte, et uniquement à
partir d'une graine explicite.

**Toute action qui dépense une ressource ou déplace une garnison passe par une transaction
avec verrou de ligne**, avec une clé d'idempotence. Un joueur avec trois onglets ouverts ne
doit dépenser ses ressources qu'une fois. Écrire le test de concurrence avant le code.

**L'état des ressources est évalué paresseusement** : on stocke `(montant, derniere_maj)`
et on calcule à la lecture. Aucune boucle de jeu, aucun état en mémoire entre les requêtes.

**Les événements futurs sont des lignes horodatées.** Ceux qui n'affectent qu'un joueur
sont résolus à sa connexion ; ceux qui affectent autrui sont dépilés par `/worker`.

## Tests

- `/engine` doit être couvert par des tests unitaires avant toute intégration.
- Les campagnes simulées servent de tests de non-régression : une graine + une population +
  des politiques de robots donnent un résultat figé. Commiter ces instantanés.
- Test de concurrence obligatoire : 200 requêtes simultanées sur le même stock ne doivent
  jamais produire de solde négatif.

## Commandes

```
npm test              tests unitaires
npm run sim           exécute une campagne complète et produit un rapport
npm run migrate       migrations de base
npm run dev           serveur de développement
```

## Style de collaboration

- Proposer un plan avant toute modification touchant plus de trois fichiers.
- Préférer une petite fonction pure testable à une abstraction générique.
- Signaler toute règle de `RULES.md` qui paraît ambiguë ou contradictoire plutôt que de
  trancher seul.
- Ne pas ajouter de dépendance sans la justifier.
