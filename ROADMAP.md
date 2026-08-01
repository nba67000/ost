# Roadmap — jeu de campagne coopératif

## Principe directeur

Le risque de ce projet n'est pas technique, il est de savoir si la boucle est amusante
et si les gens reviennent. La roadmap est donc ordonnée par **risque décroissant**,
pas par facilité croissante : on valide l'équilibrage avant d'écrire une ligne d'interface,
et on met des humains dessus le plus tôt possible.

Corollaire : **le moteur avant le jeu**. Toute la simulation est déterministe et
événementielle — elle peut tourner sans base de données, sans serveur et sans joueurs.
Une campagne de 30 jours doit s'exécuter en quelques secondes en local.

---

## Phase 0 — Figer les règles (2 à 3 soirées)

Pas de code. Un document de règles qui sert de source de vérité, pour toi et pour
l'assistant.

Livrables :
- `docs/RULES.md` — formules de production, coûts, courbes, durées, tables de blessure
- `docs/GLOSSARY.md` — vocabulaire du domaine (Veilleur, Marcheur, Feu de Guet, Forgé,
  campagne, acte, apprenti, compagnon…)
- `docs/DECISIONS.md` — journal des arbitrages, avec la raison. Tu y reviendras.

Règle : aucune constante d'équilibrage en dur dans le code. Tout dans un fichier de
configuration versionné, pour pouvoir rejouer une campagne avec d'autres réglages.

---

## Phase 1 — Le moteur headless (3 à 4 semaines)

TypeScript pur. Pas de base, pas de réseau, pas d'interface. Des fonctions et des tests.

À construire :
- Le modèle d'état (royaume, points de la carte, joueurs, garnisons, stocks)
- L'évaluation paresseuse des ressources : `(montant, dernière_maj)` → montant à l'instant T
- La file d'événements horodatés et son ordonnanceur
- La progression de la horde sur le graphe d'adjacence
- La résolution de siège et de combat, déterministe et testable en isolation
- Les blessures, la convalescence, la rotation
- La génération de carte sous contraintes, à partir d'une graine

Puis, et c'est le cœur de la phase :
- **Des joueurs-robots** avec des politiques simples (l'assidu, l'irrégulier, l'égoïste,
  celui qui abandonne au jour 8)
- Un exécuteur de campagne complète : graine + population + politiques → résultat en secondes
- Des rapports : le royaume tient-il ? à quel jour cède-t-il ? les apprentis produisent-ils
  assez ? l'échelle sous-linéaire est-elle correcte à 10, 40, 150 joueurs ?

Critère de sortie : tu peux répondre « à 25 joueurs, la campagne se joue au jour 26 dans
70 % des graines » sans avoir jamais montré le jeu à personne.

C'est la phase où ton expérience du batch et du calcul déterministe vaut le plus.

---

## Phase 2 — Persistance et API (2 à 3 semaines)

Postgres + une couche fine autour du moteur. Le moteur reste pur ; la base ne fait que
stocker et restituer l'état.

À construire :
- Le schéma (joueurs, points, garnisons, stocks, événements, blessures, commandes)
- L'application paresseuse à la lecture, la matérialisation à l'écriture
- Un worker qui dépile les événements échus (les vagues doivent tomber même si personne
  n'est connecté)
- **Les transactions et les verrous de ligne** sur toute action qui dépense une ressource
  ou déplace une garnison, avec des clés d'idempotence

Ce dernier point est le seul vrai piège technique du projet. Un joueur avec trois onglets
ouverts doit dépenser ses ressources une seule fois. Écris les tests de concurrence avant
le code.

Critère de sortie : un script qui lance 200 requêtes concurrentes sur le même stock et
ne produit jamais de solde négatif.

---

## Phase 3 — Le client volontairement laid (3 à 4 semaines)

Next.js. Des tableaux, des chiffres, des liens. Zéro illustration, zéro animation.
L'esthétique d'un OGame de 2003, assumée.

À construire :
- Écran royaume : stocks, production, files
- Écran carte : liste des points, qui tient quoi, jours de vivres restants
- Écran atelier : produire, honorer une commande
- Écran Marche : sa garnison, sa posture, son état
- Rapports de siège lisibles
- Notifications (arrivée de vague, fin de convalescence, commande honorée)
- Utilisable au pouce sur téléphone

Critère de sortie : tu peux jouer une campagne entière toi-même, avec des robots autour.

---

## Phase 4 — Campagne 0 (4 semaines de jeu réel)

10 à 15 personnes recrutées à la main. Discord ouvert dès le premier jour, il sert à la
fois de canal de recrutement et de couche sociale du jeu.

L'objectif n'est pas que ce soit amusant. L'objectif est de trouver **où les gens
s'arrêtent**.

À instrumenter dès le début :
- Jour d'abandon de chaque joueur
- Temps passé par écran
- Délai apprenti → première montée sur la Marche
- Volume réel d'échanges entre joueurs (c'est le pilier central : s'il est faible, tout
  le design est à revoir)
- Ce que font les gens pendant leur convalescence

Critère de sortie : tu sais nommer la raison n°1 pour laquelle on quitte.

---

## Phase 5 — Itérer, puis ouvrir

Deux ou trois campagnes de 4 semaines en cercle restreint, une correction majeure par
campagne. Ouverture publique seulement quand la rétraction à J7 se stabilise.

---

## Découpage du dépôt

```
/engine      TypeScript pur, aucune I/O, aucune dépendance à la base ou au réseau
/db          schéma, migrations, accès
/worker      ordonnanceur d'événements
/web         Next.js
/sim         exécuteur de campagnes, politiques de robots, rapports
/config      constantes d'équilibrage versionnées
/docs        RULES, GLOSSARY, DECISIONS
```

La pureté de `/engine` est ce qui rend le travail assisté sûr : tant qu'il n'a pas d'effets
de bord, une refonte se valide par les tests en quelques secondes.

---

## `CLAUDE.md` à poser à la racine

Contenu minimal :

- Le vocabulaire du domaine, en français, avec la consigne de ne jamais le traduire
- La règle « `/engine` reste pur — aucune I/O, aucun accès base, aucun `Date.now()`,
  l'instant est toujours un paramètre »
- La règle « aucune constante d'équilibrage en dur, tout passe par `/config` »
- La règle « toute action qui dépense une ressource passe par une transaction avec verrou »
- Un renvoi vers `docs/RULES.md` comme source de vérité de l'équilibrage
- Les commandes du projet (tests, simulation, migrations)

---

## Ce qui n'est PAS dans la v1

À écrire noir sur blanc, parce que c'est ce qui fait déraper les projets solo :

- Les voies ingénieur et espion jouables
- Les alliances formelles
- Les Annales et la persistance entre campagnes
- La puissance de Varhal reportée d'une campagne à l'autre
- Les doctrines partagées
- Les lieux nommés par les joueurs
- Les lieutenants avec comportements distincts
- Toute forme d'art ou d'identité visuelle
- Toute monétisation

Tout cela est bon. Rien de tout cela ne répond à la question « est-ce que l'échange
apprenti–Marcheur est amusant ». Ça vient après la campagne 0.

---

## Repère de temps

À un rythme de soirées et de week-ends, avec un CDI et un autre projet en cours :
**environ quatre à cinq mois jusqu'à la campagne 0**. La phase 1 est la plus longue et
la plus ingrate, et c'est celle qu'il ne faut surtout pas raccourcir — c'est elle qui
t'évite de découvrir au jour 12 d'une vraie campagne que l'économie ne boucle pas.
