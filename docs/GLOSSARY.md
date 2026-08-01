# Glossaire — L'Ost

Vocabulaire de référence du projet. **Tous les termes du domaine sont en français et ne
doivent jamais être traduits**, ni dans le code, ni dans l'interface, ni dans les commentaires.
Les identifiants de code reprennent ces termes en `snake_case` sans accents
(`feu_de_guet`, `place_forte`, `marcheur`).

---

## Le monde

**L'Ost** — le nom du jeu. Désigne aussi l'armée féodale convoquée pour une campagne.
On *lève l'ost* au début d'une lune, on le *démobilise* à la fin.

**Le Royaume** — l'entité permanente. Un graphe d'une douzaine de provinces, défini une
fois pour toutes à la création d'un monde. Ne change pas d'une lune à l'autre.

**Province** — un nœud du royaume. Trois états possibles : *tenue*, *en guerre*, *perdue*.
La province en guerre est celle dont la carte tactique est générée pour la lune en cours.

**Carte** — le graphe tactique généré chaque lune pour la province en guerre. Jetable.

**Lieu** — un nœud de la carte. Quatre natures : `place_forte`, `feu_de_guet`,
`poste_avance`, `fosse`. Chaque lieu est `tenu_par` le royaume, la horde, ou est
`detruit` (état terminal réservé aux Fosses percées).

**Place forte** — le cœur de la province. Une seule. 3 à 4 abords. Si elle tombe, la
province est perdue.

**Feu de Guet** — le poste ordinaire, commandé par un sergent. 2 abords. Une garnison qui
le tient force la horde à l'assiéger : c'est le mécanisme qui rend un petit joueur
stratégiquement décisif.

**Poste avancé** — petit lieu exposé, 1 abord.

**Abord** — un point d'accès à un lieu (la porte, une brèche, une poterne, un flanc).
Unité de base de la résolution de combat.

**Route** — lien entre deux lieux. Porte les troupes **et** le ravitaillement.

**Sentier** — lien entre deux lieux. Porte les troupes **seulement**. Un lieu relié
uniquement par sentier peut être renforcé mais pas nourri.

**Secteur** — regroupement de lieux commandé par un capitaine. Apparaît seulement
au-dessus d'un certain effectif.

**Entrée** — lieu par lequel la horde pénètre dans la province. Situé du côté de la
province perdue lors de la lune précédente.

**Fosse** — installation de la horde située **au-delà** des entrées, en territoire ennemi,
reliée par sentiers uniquement. **Nature de lieu à part entière** (2 abords), défendue.
Une expédition doit la percer ; elle ne se prend pas, elle se **détruit**. Produit les
vagues. Les détruire toutes avant la fin de la lune donne la victoire décisive.

**Entrée principale** — parmi les entrées d'une lune, celle qui reçoit la pression majeure
de la horde. Déterminée par la province perdue la lune précédente.

---

## Le temps

**Lune** — une campagne. Environ 30 jours. Nommée d'après la province défendue
(*la lune de Loncrête*). L'unité de remise à zéro.

**Acte** — un tiers de lune (10 jours). Se clôt par une offensive nommée menée par un
lieutenant. Trois actes par lune.

**Jour** — l'unité de rythme. Rapport du matin → renseignement dans la journée → ordres
verrouillés le soir → assaut → conséquences.

**Assaut** — la résolution quotidienne, à heure civile fixe.

**Entre-deux-lunes** — 2 à 3 jours entre deux campagnes. Phase stratégique de basse
intensité : mise à jour du royaume, bilan, choix du fragment, annonce de la province
suivante.

**Guerre** — la suite des lunes contre un même Varhal. S'achève quand il perd sa dernière
province.

**Ère** — quand une guerre s'achève, un nouveau monde limitrophe de douze provinces est
généré.

---

## Les joueurs

**Veilleur** — terme générique pour un joueur affecté à l'arrière (cœur de la province) :
production, formation, réparation.

**Marcheur** — terme générique pour un joueur en poste sur la Marche, la frontière.

**Grade** — qualification personnelle. Six échelons : `recrue`, `soldat`, `caporal`,
`sergent`, `capitaine`, `general`. Le grade **persiste entre les lunes** mais décroît d'un
cran s'il n'est pas exercé pendant une lune entière.

**Poste** — affectation rare, propre à la lune. Le grade rend éligible, le poste doit être
vacant. Un blessé libère son poste, pas son grade.

**Intérim** — celui qui assure un poste vacant. Peut conserver le poste au retour du
titulaire s'il l'a mérité.

**Posture** — la disposition d'un paquet de garnison sur un abord. Quatre valeurs :
`mur`, `cognee`, `fer`, `reserve`.

**Réserve** — fraction de garnison non affectée, engagée automatiquement selon des
**conditions** écrites à l'avance par le gradé. Le nombre de conditions autorisées dépend
du grade.

**Convalescence** — état d'un joueur blessé. Il retourne au cœur, ne peut pas combattre,
produit et forme les recrues.

**Fragment** — ce qu'un joueur emporte d'une lune à la suivante. Toujours un objet nommé
(titre, marque, mention aux Annales), jamais un pourcentage, jamais de la puissance.
Le joueur **choisit** son fragment.

**Origine** — la province du royaume dont le joueur est natif, choisie à l'inscription.
Quand elle tombe, c'est chez lui.

**Quête** — objectif personnel secret attribué à chaque lune. Se réalise toujours **en
obéissant**, jamais en quittant son poste.

**Bannière** — l'héraldique du joueur : forme d'écu, deux couleurs, une charge.

---

## L'ennemi

**Varhal, le Roi sans Sommeil** — l'antagoniste. Persiste entre les lunes. Sa puissance
est une variable globale du royaume.

**Forgé** — soldat de Varhal. Fabriqué, pas né. Cinq types :

| Type | Comportement |
|---|---|
| `souche` | La masse, lente et innombrable |
| `ecorcheur` | Rapide, contourne la ligne, coupe les convois |
| `belier` | Bête de siège, brise les portes |
| `chien_de_fosse` | Pisteur, trouve le point faible d'un secteur |
| `muet` | Garde de lieutenant, n'obéit à aucun ordre audible |

**Lieutenant** — capitaine nommé de Varhal. Deux ou trois par lune, chacun avec une
**doctrine** fixe et apprenable. Mène l'offensive de fin d'acte.

**Vague** — l'assaut quotidien. Composition et abord visé déterminés par la doctrine du
lieutenant et la production des Fosses.

---

## Les PNJ

**Le maître ingénieur** — vend ouvrages et engins de siège. File d'attente unique et
disputée.

**L'espion** — vend **une** réponse exacte par cycle à une question posée par le général.

**Le maître des poudres** — conditionne les expéditions offensives.

Tous les PNJ sont **rares, partagés et perdables** : si leur lieu tombe, le royaume perd
la capacité pour le restant de la lune.

---

## La mémoire

**Les Annales** — le registre permanent. Y sont inscrits les noms, les titres, les lieux
baptisés, les doctrines. Survit aux lunes.

**Legs** — l'acte volontaire, en fin de lune, par lequel un joueur inscrit un texte de son
choix sur un lieu qu'il a tenu. Définitif.
