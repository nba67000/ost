# Règles — L'Ost

Source de vérité de la simulation. Toute divergence entre ce document et le code est un
bug du code.

**Toutes les valeurs chiffrées de ce document sont provisoires** et marquées `[calibrer]`.
Elles vivent dans `/config`, jamais en dur dans `/engine`. Elles seront fixées par la
simulation en phase 1, pas par intuition.

---

## 1. Vue d'ensemble

Jeu de stratégie asynchrone, navigateur, coopératif. Les joueurs défendent une province
d'un royaume médiéval contre l'armée de Varhal. Une campagne dure une lune (~30 jours),
après quoi tout est remis à zéro sauf le royaume et quelques fragments personnels.

Les joueurs se répartissent entre l'arrière (production, formation) et la Marche
(combat, commandement). Ce ne sont pas deux populations mais **deux étapes d'une même
carrière** : tout le monde commence à l'arrière, tout le monde monte sur la Marche.

Session cible : **30 minutes par soir**.

---

## 2. Le temps

- Une **lune** dure 30 jours.
- Elle se divise en **3 actes** de 10 jours.
- Chaque acte se clôt par une **offensive de lieutenant** (jours 10, 20, 30), calée sur un
  samedi.
- Un **assaut** ordinaire est résolu chaque jour à heure civile fixe `[calibrer, ~21h]`.
- Les **ordres se verrouillent** à H-1 avant l'assaut.
- **Entre-deux-lunes** : 2 à 3 jours.
- **Pas d'assaut au jour 1** — rodage. Le premier assaut a lieu le soir du jour 2.

Un seul royaume, un seul fuseau horaire (Europe/Paris) pour la v1.

### Rythme du jour

| Moment | Contenu |
|---|---|
| Matin | Rapport de l'assaut de la veille |
| Journée | Retour des patrouilles, livraison de l'espion, arrivée des convois |
| Soir | Fenêtre de décision : répartition, postures, réserve et conditions |
| H-1 | Verrouillage des ordres |
| H | Assaut, résolution, conséquences |

**Arbitrage central du jeu** : verrouiller tôt donne un bonus de préparation
`[calibrer]` (la garnison a le temps de se retrancher) ; verrouiller tard donne le
renseignement le plus fiable. Modifier des ordres après un premier verrouillage coûte de
la fatigue `[calibrer]`.

---

## 3. Le monde

### Royaume

Graphe permanent de 12 provinces, généré une fois. Chaque province est `tenue`,
`en_guerre` ou `perdue`.

La horde ne peut attaquer qu'une province limitrophe d'une province qu'elle tient.
**Le résultat d'une lune détermine le lieu de la suivante.**

### Génération de la carte tactique

Générée à chaque lune pour la province en guerre, à partir d'une graine.

Contraintes obligatoires du générateur :

- Nombre de lieux ≈ `effectif_actif / 3`, plancher 5, plafond 25
- Exactement 1 place forte
- Profondeur de 3 à 4 sauts entre une entrée et la place forte
- Topologie : **arbre + 2 ou 3 cycles**. Ni maillage dense (aucune perte ne compte), ni
  arbre pur (toute perte ampute une branche)
- 2 à 4 goulots garantis
- 1 à 3 entrées, toutes situées du côté de la province perdue la lune précédente
- Les Fosses sont placées au-delà des entrées, reliées par **sentiers uniquement**

L'aléatoire porte sur la forme, **jamais sur l'équité**.

### Algorithme de génération

Déterministe à partir d'une graine. Construction **par couches**, du cœur vers l'extérieur.

```
1. N = clamp( round( effectif_actif × carte.lieux_par_joueur_actif ),
              carte.lieux_min, carte.lieux_max )
     N compte les lieux du royaume UNIQUEMENT. Les Fosses s'ajoutent
     par-dessus à l'étape 10.

2. D = tirage( carte.profondeur_entree_place_forte_min,
               min( carte.profondeur_entree_place_forte_max,
                    N - carte.entrees_min ) )                       profondeur

3. E = tirage( carte.entrees_min,
               min( carte.entrees_max, N - D ) )                    nb entrées

     Les bornes des étapes 2-3 garantissent la contrainte
     N - 1 - E >= D - 1 par construction : une répartition avec au
     moins un lieu par couche intermédiaire est toujours faisable.

4. Répartir les N lieux sur D+1 couches :
     couche 0 = la place forte (1 lieu)
     couche D = les entrées (E lieux)
     les N-1-E lieux restants sur les couches 1..D-1,
     avec au moins 1 lieu par couche, en croissant vers l'extérieur.
     **Bump structurel** : quand c'est possible (reste ≥ D), la couche 1
     reçoit au moins 2 enfants directs de la PF — sans quoi une chaîne à
     petit N rend toute la province tributaire d'un lieu unique.

5. Arbre : chaque lieu de la couche k reçoit exactement un parent
   tiré dans la couche k-1. Toutes ces arêtes sont des ROUTES.

6a. Routes redondantes : ajouter des arêtes ROUTES supplémentaires **de façon
    gloutonne**, entre lieux de couches identiques ou adjacentes non déjà reliés.
    Deux phases séquentielles :

    **Phase A (primaire) : minimiser la fragilité maximale.**
    Objectif : aucun lieu (hors PF) ne doit déconnecter plus de
    `max( carte.fragilite_plancher_absolu, round(N × carte.fragilite_max_coef) )`
    autres lieux du royaume. Le plancher absolu (par défaut 3) rend explicite
    l'acceptation d'une fragilité modérée à petit N. À chaque itération,
    choisir l'arête qui réduit le plus la fragilité maximale.

    **Phase B (secondaire) : ramener les goulots dans la fenêtre.**
    Fenêtre = [ round(N × carte.goulots_coef_min),
                round(N × carte.goulots_coef_max) ] avec plancher 0 et
    largeur minimale `carte.goulots_fenetre_min`. Choisir l'arête qui réduit
    le plus le nombre de goulots.

    S'arrêter dès que l'objectif de la phase est atteint, ou qu'aucune arête
    candidate n'améliore plus.

    Les routes redondantes sont ce qui donne la **redondance de
    ravitaillement** : elles créent des chemins alternatifs pour le convoi.

6b. Sentiers : ajouter
     nb_sentiers = clamp( round( N / generation.sentiers_par_lieux ),
                          generation.sentiers_min, generation.sentiers_max )
    arêtes SENTIER, entre les candidats restants (mêmes règles de proximité).
    Purement tactiques (mobilité de garnison), ne réduisent aucun goulot
    puisque le ravitaillement ne passe que par les routes.

7. Natures des lieux royaume : couche 0         = place_forte
                               couches D-1 et D = poste_avance
                               le reste          = feu_de_guet

8. Abords : place_forte  = tirage( combat.abords_place_forte_min,
                                   combat.abords_place_forte_max )
            feu_de_guet  = carte.abords.feu_de_guet
            poste_avance = carte.abords.poste_avance
            fosse        = carte.abords.fosse
            Disposés en anneau.
   Chaque abord reçoit une fortification de base selon la nature du lieu :
     place_forte  = nb_abords × carte.fortification_base.place_forte_par_abord
                    (chaque abord additionnel demande un cran de plus pour
                    compenser la surface exposée : 3 abords → 3, 4 abords → 4)
     feu_de_guet  = carte.fortification_base.feu_de_guet  (1 par défaut,
                    marge de progression du sergent)
     poste_avance = carte.fortification_base.poste_avance (0 par défaut)
     fosse        = carte.fortification_base.fosse        (0 par défaut)

9. Terrain : tirer un terrain dominant pour la province, puis l'attribuer
   à generation.part_terrain_dominant des lieux ; le reste tiré uniformément.

10. Fosses : ajouter tirage( generation.fosses_min, generation.fosses_max )
    lieux de nature `fosse`, tenus_par `horde`, placés au-delà des entrées,
    reliés chacun à une entrée tirée aléatoirement, par un SENTIER.
    Une Fosse ne se prend pas : elle se `detruit`.

11. Entrée principale : parmi les E entrées, désigner l'entrée principale
    — celle d'où vient la pression majeure de la horde. Tirée à partir
    de province_perdue_id (RNG dérivé), pour rester stable entre lunes.
    Si aucune province n'a été perdue, l'entrée principale est tirée
    depuis un contexte fixe.

12. Secteurs : partitionner par sous-arbre si l'effectif débloque les
    capitaines, sinon un secteur unique. La place forte et les Fosses
    n'appartiennent à aucun secteur.
```

L'étape 5 garantit que **toute arête d'arbre est une route**, donc que tout lieu royaume
est approvisionnable au départ. Les sentiers ne sont que des raccourcis tactiques.

### Vérification et rejet

Deux vérifications résiduelles :

- **Fragilité maximale** ≤ cible (voir phase A). Le motif de rejet
  `fragilite_excessive` est le plus important — c'est la propriété qui
  empêche une province de tomber sur une seule bataille.
- **Aucun lieu** à plus de `D` sauts de la place forte.

Le nombre de goulots n'est plus un critère de rejet — il est contraint par
construction en phase B.

Si la vérification échoue : **retirer avec une graine dérivée**, jusqu'à
`generation.essais_max` essais par niveau.

Au-delà, **relâcher les contraintes dans cet ordre fixe**, une seule à la fois, et
recommencer :

1. Nombre de sentiers ramené à 1
2. `D` ramené à 3
3. Cible de fragilité désactivée

Ce court ordre est **normatif**. La cible de fragilité est relâchée en
DERNIER — c'est la contrainte la plus importante. Un déclenchement fréquent
du relâchement de niveau 3 signale que les paramètres du config sont mal
réglés.

### Terrain

Chaque lieu porte un terrain qui modifie ses abords et les postures. Le terrain dominant
donne son identité à la lune (*la lune des marais*).

| Terrain | Effet |
|---|---|
| `crete` | Bonus de fortification |
| `marais` | Moins d'abords, ravitaillement ralenti |
| `foret` | Favorise les écorcheurs |
| `plaine` | Neutre |
| `delta` | Routes fragiles, sentiers nombreux |

### Modèle de données

```
lieu(id, nature, terrain, secteur_id, abords[], fortification, tenu_par)
    nature   : place_forte | feu_de_guet | poste_avance | fosse
    tenu_par : royaume | horde | detruit
lien(a, b, nature: route | sentier)
province(id, lieux[], liens[], entrees[], entree_principale, place_forte_id, fosses[])
```

---

## 4. Ravitaillement

Un lieu est **approvisionné** s'il existe un chemin de lieux tenus, empruntant uniquement
des **routes**, jusqu'à la place forte.

Calcul : simple parcours en largeur depuis la place forte, **une fois par jour civil,
avant l'assaut**.

Les vivres sont exprimés en **jours de siège restants**, jamais en quantité brute —
c'est une horloge, pas un compteur.

### Capacité maximale par nature de lieu

| Nature | Capacité max |
|---|---|
| `place_forte` | 10 jours |
| `feu_de_guet` | 6 jours |
| `poste_avance` | 3 jours |

### Consommation

- **1 jour par jour civil** si le lieu est tenu, **indépendamment de la taille de la
  garnison**.
- **+1 jour supplémentaire** si un assaut a eu lieu ce jour-là sur ce lieu.
- Un lieu vide (garnison nulle) **ne consomme pas**.

### Recharge

- **+2 jours par jour civil** si le lieu est approvisionné, plafonnée à la capacité max.
- Un lieu non approvisionné ne reçoit rien.
- Terrain `marais` : recharge divisée par 2 (coefficient `terrain.marais.recharge = 0.5`).

### Garnison affamée

Le coefficient `garnison_affamee` **s'applique de façon progressive** entre 2 jours restants
et 0 jour, pas de manière binaire.

```
ravitaillement_effectif =
    1 - (1 - garnison_affamee) × max(0, (seuil_affamee_jours - jours_restants) / seuil_affamee_jours)
```

### Convois et escortes

En v1, les convois et escortes **ne sont pas des entités mobiles**. Escorter est une
**action de joueur** qui améliore la recharge du lieu destinataire. Pas de pathfinding.

Conséquence recherchée : perdre un lieu n'est jamais local, ça étrangle un voisin.

---

## 5. Économie

**Le territoire produit, les joueurs transforment.**

- Chaque province tenue fournit passivement des matières brutes `[calibrer]`.
- Les ateliers de l'arrière transforment les matières en équipement et en vivres.
- La matière **se perd** : il faut un flux d'entrée constant. Étrangler ce flux est le
  vrai mécanisme de défaite.

Tant que la simulation n'a pas différencié les recettes, un **taux unique**
`economie.rendement_atelier` s'applique à toutes. La différenciation viendra des
rapports de simulation, pas de l'intuition.

### Usure

- L'équipement ne disparaît pas : il s'ébrèche. L'usure se compte en **batailles
  restantes**, jamais en pourcentage.
- Une pièce usée combat moins bien avant de casser.
- Réparer est moins cher que remplacer. Le matériel abîmé **repart vers l'arrière**, ce
  qui referme la boucle : la recrue voit revenir ce qu'elle a fabriqué.
- À la démobilisation, tout l'équipement est ramené au **même état d'usure** quel que soit
  son état antérieur : environ 3 à 5 batailles restantes `[calibrer]`, soit un acte.
  Un plancher, pas un incrément.
- Une pièce peut être **refondue** : son acier devient le cœur d'une pièce neuve forgée par
  un apprenti, qui reçoit le crédit du travail. Le nom de la pièce peut se transmettre.

### Comptage par assaut

Unité : **une unité d'usure par assaut où la pièce a été engagée**
(`usure.par_assaut = 1`), quel que soit le nombre de rounds. Compte discret, planifiable,
conforme à la règle « on compte en batailles ».

- **+`usure.penalite_abord_rompu`** si l'abord où la pièce a combattu a cédé.
- Un joueur en réserve non engagée ne consomme rien.
- Une pièce à 0 est détruite et retirée. Le joueur combat alors avec le plancher
  `combat.modificateurs.usure_equipement_min`.

Avec `economie.usure_batailles_neuf = 12`, une pièce neuve tient une dizaine d'assauts.
Avec `economie.usure_batailles_apres_demobilisation = 4`, l'équipement du vétéran au
jour 1 d'une lune tient environ le premier acte — c'est l'effet recherché : sa première
commande aux ateliers part immédiatement.

### Auto-production du vétéran

Un joueur en poste peut produire lui-même, à environ **30 % de rendement** `[calibrer]`.
Il n'est donc jamais bloqué par l'inaction d'autrui, seulement ralenti. Cela fixe
naturellement un prix plancher et un plafond pour les échanges.

### Commandes

Un Marcheur passe **commande nominative** à un joueur de l'arrière : une pièce précise,
pour une date. Le destinataire accepte ou refuse. Ce n'est pas un stock commun anonyme.

---

## 6. Combat

Déterministe. **Aucun jet de dé.** L'incertitude vient exclusivement de ce que le joueur
ignore de l'ennemi.

### Structure

Un assaut oppose, sur chaque **abord** d'un lieu, un paquet de garnison à un paquet de
Forgés. Le gradé répartit sa garnison entre les abords et choisit une **posture** pour
chaque paquet, sans connaître la répartition ennemie.

C'est formellement un jeu de répartition de type Blotto : déterministe, sans stratégie
dominante.

### Matrice de posture

| Posture | Excelle contre | S'effondre contre |
|---|---|---|
| `mur` | `souche` | `belier` |
| `cognee` | `belier`, engins | `ecorcheur` |
| `fer` | `muet`, élite | `souche` en nombre |

Les coefficients exacts sont dans `/config`. La posture `reserve` **n'a pas de
coefficients propres** : la réserve, quand elle engage, adopte la posture de l'abord
qu'elle rejoint.

### Force effective d'un paquet

```
force_effective(abord) =
    effectif
  × coef_posture(posture, composition_vague)
  × produit_modificateurs
```

Le résultat est **clampé** dans `[clamp_force_min, clamp_force_max] × effectif`
(0.3 à 3.0 × effectif au départ).

**`coef_posture` face à une composition mixte** — somme pondérée par la proportion de
chaque type dans le paquet assaillant :

```
coef_posture = Σ ( proportion[type] × matrice[posture][type] )
```

**`produit_modificateurs`** — chaîne strictement multiplicative. L'ordre est sans effet
puisqu'il n'y a que des produits ; le plancher d'usure est appliqué **avant** d'entrer
dans le produit :

```
fortification^niveau × ravitaillement × fatigue × usure × coordination × preparation
```

- `usure = max(usure_moyenne_des_pieces_engagees, usure_equipement_min)`
- `coordination` : celle du commandant du lieu. **Ne cumule pas** avec celle d'un
  supérieur hiérarchique. `recrue` et `soldat` valent 1.0.
- `preparation` : s'applique à **tous les abords du lieu**, sur **tous les rounds** de
  l'assaut, si les ordres ont été verrouillés avant midi.
- `ravitaillement` : coefficient calculé par §4 (progressif entre 2 jours restants et 0).
- `fatigue` : `fatigue_combat_veille` si la garnison a combattu la veille, sinon 1.0.
- `fortification` : `fortification_par_niveau ^ niveau_abord`, éventuellement modifié par
  le terrain (ex. `crete.fortification` en produit supplémentaire).

### Pertes

Modèle **proportionnel simultané en rapport brut**. Les deux camps sont calculés à
partir du même instantané, avant application.

```
F_d = force_effective(défenseur)
F_a = force_effective(assaillant)

pertes_d = min( effectif_d, k × effectif_d × (F_a / F_d) )
pertes_a = min( effectif_a, k × effectif_a × (F_d / F_a) )
```

`k = combat.taux_pertes_par_round` (0.18 au départ).

Le rapport `F_a / F_d` **n'est pas borné à 1** : une supériorité effective de
3 contre 1 inflige mécaniquement `3 × k = 54 %` de pertes par round, jusqu'au
plafond de l'effectif lui-même. À parité, on retrouve `k` (~18 % par round).

Les pertes sont exprimées en **effectif**, arrondies à l'entier inférieur, avec
un minimum de 1 si la force adverse est non nulle. Si `F_d = 0` ou `F_a = 0`,
la division est court-circuitée : l'abord vide cède au round 1 (voir cas
limites), et une vague vide n'inflige rien.

*Écarté : le facteur `F_a / (F_d + F_a)`, borné à 1, plafonnait les pertes à
`k` de l'effectif adverse quelle que soit la supériorité — une garnison de 10
tenait 5 rounds contre 1110.*

### Résolution — ordre exact d'un round

**Les abords d'un même lieu sont résolus en parallèle.** L'état de tous les abords au
début du round sert d'entrée ; les pertes sont appliquées ensuite, toutes ensemble.
Une résolution séquentielle rendrait l'ordre des abords significatif alors qu'il est
arbitraire.

1. **Instantané** de l'état de tous les abords
2. **Calcul des forces effectives** (avec malus de flanc hérité du round précédent)
3. **Calcul des pertes** des deux camps sur chaque abord
4. **Application simultanée** des pertes
5. **Évaluation des ruptures** (voir seuil ci-dessous)
6. **Marquage des voisins** des abords rompus (le malus s'appliquera **au round suivant**)
7. **Évaluation des conditions de réserve** et engagement

La réserve engagée au round N combat **à partir du round N+1**.

Rounds successifs, maximum `rounds_max = 5`. Une erreur de répartition coûte **en
cascade**, pas linéairement.

### Abords, voisinage et rupture

**Les abords d'un lieu sont disposés en anneau**, dans l'ordre produit par le générateur.
Chaque abord a donc deux voisins directs ; un lieu à 2 abords a un voisinage mutuel ; un
lieu à 1 abord n'a aucun voisin.

Le malus de flanc (`malus_flanc_apres_rupture = 0.7`) s'applique **uniquement aux voisins
directs** d'un abord rompu.

**Seuil de rupture** : un abord cède quand son effectif passe sous

```
seuil_rupture_abord × effectif_initial_de_cet_abord_au_début_de_l_assaut
```

Évalué **après** application des pertes du round.

**Place forte** : nombre d'abords tiré entre `abords_place_forte_min` et
`abords_place_forte_max` (3 à 4) par la graine.

### Brèche

Un abord qui a cédé ne bouche pas la faille. À chaque round suivant sa rupture,
la vague dirigée vers cet abord n'engage plus la fortification : elle
**entre dans l'intérieur du lieu**.

L'intérieur se défend, dans cet ordre :
1. La **réserve non encore engagée**.
2. Les **garnisons des abords restants**, pour absorber le débordement.

Combat intérieur :
- **Aucun bonus de fortification** — on se bat dans la cour, pas sur le rempart.
- **Bonus de posture PRÉSERVÉ** — on se bat dans la cour, pas en chemise.
  Chaque abord non-rompu combat avec sa propre posture ; la réserve prend
  la posture `mur` par défaut.
- **Coordination** du commandant du lieu appliquée normalement.
- Formule de pertes identique aux abords (proportionnelles simultanées).
- Les pertes défenseur sont **absorbées d'abord par la réserve**, puis
  distribuées aux garnisons d'abords non-rompus au prorata de leur effectif.
- `F_interior = Σ (segment_effectif × coef_posture(segment_posture, intrusion)) × coordination`

**Si l'intérieur est vide ou tombe, le lieu tombe**, même si un abord tient
encore. En pratique : tous les abords rompus, ou l'intérieur (réserve +
garnisons d'abords non-rompus) réduit à zéro.

Le malus de flanc sur les abords voisins d'un abord rompu subsiste.

### Malus d'engagement de la réserve

Une réserve engagée en cours d'assaut arrive en désordre. **Au round où
elle entre en ligne** (round N+1 après l'engagement au round N), l'abord
qui l'a reçue subit un coefficient `combat.malus_engagement_reserve` (0.8)
sur sa force effective. Le malus ne dure qu'un round.

Être en place au début vaut mieux que réagir à effectif égal.

### Rupture du lieu par effondrement de l'intérieur

À la fin de chaque round **où l'intérieur est engagé** (au moins un abord
rompu au début du round), comparer :

- **F_intérieur** après pertes = (réserve restante + garnisons des abords
  non-rompus) × coordination du commandant.
- **F_intrusion survivant** = Forgés entrés par la brèche moins les pertes
  qu'ils ont subies ce round.

Si

```
F_intérieur  <  combat.seuil_effondrement × F_intrusion_survivant
```

le lieu **tombe immédiatement**, quel que soit l'état des abords restants
et le nombre de rounds écoulés. `combat.seuil_effondrement = 0.5` par
défaut.

Effet : percer un abord n'est plus une étape parmi d'autres, c'est le
basculement de l'assaut.

### Plafond de réserve

À la construction de l'ordre, la réserve ne peut pas excéder
`combat.part_reserve_max` (0.4) de la garnison totale du lieu.
Garde-fou grossier : trop en réserve, c'est trop peu sur les murs.

### Réserve conditionnelle

Le gradé garde des hommes en arrière et écrit les **conditions** de leur engagement. Les
conditions sont un **DSL fermé**, jamais du texte libre :

```json
{
  "ordre": 1,
  "declencheur": {
    "abord_id": "porte",
    "metrique": "effectif_restant_relatif",
    "comparateur": "<",
    "seuil": 0.5
  },
  "action": { "abord_cible": "porte", "part_reserve": 0.5 }
}
```

- `effectif_restant_relatif` est relatif à l'effectif initial de l'abord **au début de
  l'assaut**.
- `abord_id` est nommé au moment de l'ordre et **n'est pas réévalué dynamiquement**.
- Plusieurs conditions déclenchées au même round s'exécutent **dans l'ordre d'écriture**.
  Si la réserve est épuisée, les suivantes ne s'appliquent pas.
- La réserve **adopte la posture de l'abord qu'elle rejoint**.

Le grade détermine le **nombre de conditions autorisées** — c'est de la bande passante
de commandement, pas de la puissance :

| Grade | Conditions |
|---|---|
| `caporal` | 1 |
| `sergent` | 2 |
| `capitaine` | 3 |
| `general` | 5, sur plusieurs positions |

`recrue` et `soldat` : 0 condition.

### Fin d'assaut et cas limites

- Un assaut s'arrête dès que **tous les abords ont cédé** (le lieu tombe), ou que
  **l'effectif assaillant est nul** (l'assaut est repoussé), ou à `rounds_max`.
- À `rounds_max` sans décision, **le défenseur l'emporte** : le lieu tient.
- **Égalité parfaite : le défenseur l'emporte.** Règle générale, applicable partout.
  Percer demande de percer.
- **Abord sans garnison** : cède immédiatement au round 1, sans combat ni matrice.
- **Poste avancé (1 abord)** : son unique abord cède ⇒ le lieu tombe.
- **Rupture simultanée de tous les abords au round 1** : le lieu tombe. La réserve,
  évaluée à l'étape 7, n'a pas le temps d'agir. C'est voulu — ne pas garder de réserve
  sur un lieu fragile est une erreur de commandement.
- **Lieu isolé** (aucun chemin de retraite, aucun voisin tenu) : il tient tant que ses
  vivres tiennent, puis cède sans combat.
- **Pas d'assaut au jour 1** (voir §2).

### Garnison sans ordres

Si le gradé ne s'est pas connecté : **posture `mur` par défaut, répartition égale entre
les abords, aucune réserve engagée, aucune condition**. Ça se bat mal mais ça se bat.
Jamais un zéro.

### Sorties offensives

**Aucun module distinct.** Une expédition réutilise la résolution ci-dessus, rôles
inversés : l'expédition est l'assaillant sur les abords de la Fosse.

- Une Fosse n'est reliée que par **sentiers** : l'expédition part sans ravitaillement,
  avec un stock de vivres qu'elle emporte et qui décroît d'un jour par jour.
- À zéro vivres, l'expédition subit le coefficient `garnison_affamee` puis se dissout,
  tous ses membres blessés.
- Détruire une Fosse retire sa production du calcul de volume **dès le lendemain**.

### Contrainte de conception à vérifier en simulation

**Aucune répartition ne doit être universellement gagnante.** Si le solveur en trouve une,
le combat est mort. À vérifier en phase 1.

---

## 7. La horde

- Les **Fosses** produisent. Leur production cumulée entre dans le calcul du volume des
  vagues.
- Chaque **lieutenant** a une **doctrine fixe** : l'un feinte toujours sur un flanc,
  l'autre masse sur la porte, le troisième coupe les convois. Les doctrines sont
  **apprenables** — c'est ce qu'un vétéran conserve après la démobilisation.
- La puissance de Varhal est une variable globale reportée d'une lune à l'autre.

### Volume et adaptation

```
effectif_total_royaume = Σ effectif_commande[grade] pour tout joueur actif
volume_base            = pression_base × production_cumulee_des_fosses × puissance_varhal
volume                 = volume_base × effectif_total_royaume ^ exposant_adaptation_population
effectif_par_front     = effectif_total_royaume / nb_fronts
volume                 = clamp( volume,
                                plancher_coef × effectif_total_royaume,
                                plafond_coef  × effectif_total_royaume )
```

`effectif_total_royaume` est **la même mesure** que celle utilisée pour dimensionner la
carte à §3. Une seule fonction, appelée partout — jamais deux définitions de "l'effectif".
Elle ne dépend PAS de la garnison réellement placée : le volume ennemi ne doit jamais
dépendre de ce que le joueur a choisi de mettre où, sinon renforcer une position
n'apporte rien.

`plancher_coef = 0.6` et `plafond_coef = 2.5` se lisent directement contre les ratios de
bascule mesurés au banc de combat : 1.06 pour un abord nu, 1.48 pour un feu de guet
fortifié, 2.0-2.4 pour la place forte. `plafond_coef = 2.5` signifie que la horde peut au
pire atteindre le niveau qui bascule la place forte.

`pression_base` est calibré par inversion sur une population de référence (mélange
représentatif, effectif ≈ 286) pour que le volume ordinaire vaille environ 1,2 fois
l'effectif total.

Cinq règles impératives :

1. **Sous-linéaire** : `exposant_adaptation_population ≈ 0,7`. Dix joueurs de plus doivent
   alléger la charge de chacun.
2. **Mesurer l'effectif commandé, pas les têtes** : un joueur COMMANDE des hommes selon
   son grade. `Σ effectif_commande[grade]` sur les joueurs actifs.
3. **Indépendant de la garnison** : le volume ennemi n'utilise jamais l'effectif du
   défenseur RÉELLEMENT présent sur un lieu — sinon renforcer un abord y attire plus
   d'ennemis, ce qui punit la défense.
4. **Faire varier l'ampleur, pas la puissance** : jamais un Forgé plus fort. Plus
   d'ennemis, sur plus de fronts simultanés. La difficulté est une pénurie d'attention.
5. **Ne jamais s'adapter au succès récent** : une doctrine ne consulte jamais l'historique
   des victoires. Sinon les joueurs apprennent que réussir est puni.

**L'adaptation doit être visible** : puissance de Varhal affichée, taille de la prochaine
vague annoncée par les éclaireurs. Ce qui est transparent cesse d'être du caoutchouc.

### Doctrine — fonction pure

Une doctrine est une **fonction pure** :

```
doctrine(jour, volume, carte, etat_horde) -> Vague[]
Vague = { lieu_id, abord_id, composition: Record<TypeForge, number> }
```

**Six doctrines au total** (`horde.doctrines_total`), **trois tirées par lune** à partir
de la graine (`horde.doctrines_par_lune`). Chacune définit un profil de composition fixe
et une règle de ciblage. Toute règle s'applique **uniquement parmi les lieux exposés du
jour** — jamais sur un lieu que la horde ne peut pas atteindre.

| Doctrine | Composition | Préférence de lieu (parmi exposés) | Abord ciblé |
|---|---|---|---|
| **Marteau** | 70 % bélier · 30 % souche | Le plus fortifié | Le plus fortifié |
| **Écorcheurs** | 100 % écorcheur | Le moins fortifié | Le moins fortifié |
| **Meute** | 60 % chien_de_fosse · 40 % souche | Le plus faiblement garni | Le moins garni |
| **Rouleau** | 100 % souche | Aucune (ordre lexicographique) | Le plus petit ID |
| **Garde** | 50 % muet · 50 % souche | `entree_principale` si exposée, sinon le plus proche BFS d'elle | Le moins fortifié |
| **Serpent** | 100 % muet | `place_forte` si exposée, sinon la plus fortifiée | Permutation dérivée de la graine de lune : `abord = perm[(jour − 1) mod nb_abords]` |

**Clause disposition ≠ historique.** La Meute est la seule doctrine qui LIT l'état
défensif du jour (effectifs par lieu et par abord). Elle ne consulte pas pour autant
l'historique des assauts — la règle §7-4 est respectée. La distinction est réelle : réagir
à la garnison observée le matin de l'assaut n'apprend pas à un joueur que réussir est puni,
puisque la garnison reflète les priorités du jour, pas les victoires passées.

**Serpent : la permutation meurt à la fin de la lune.** Chaque nouvelle lune tire une
permutation neuve, propre à chaque lieu ciblé. C'est le savoir qu'un vétéran conserve
d'une campagne à l'autre : la capacité à lire un chiffrement quotidien, pas la formule
elle-même.

### Distribution temporelle

**Nombre de fronts par jour** — c'est ici que se joue la règle « faire varier l'ampleur,
pas la puissance ».

```
nb_fronts = clamp( round( capacite ^ exposant_adaptation_population
                          / horde.diviseur_fronts ),
                   1, nb_lieux_exposes )
```

Un lieu est *exposé* s'il est adjacent à un lieu tenu par la horde ou à une entrée.

**Répartition** :

- **Un assaut par jour et par front.** Jamais deux assauts sur le même lieu le même jour.
- Les doctrines actives de la lune (`horde.doctrines_par_lune`) se partagent les fronts
  du jour en **draft cyclique** : l'ordre est une rotation dérivée uniquement du jour
  (`décalage = (jour − 1) mod N`), sur les actives triées lexicographiquement. Chaque
  doctrine occupe la position 1 exactement 1/N du temps sur la lune — aucune n'est
  structurellement première. Dans l'ordre du jour, chacune pioche à son tour son lieu le
  plus préféré parmi les exposés encore libres, jusqu'à saturer `nb_fronts`.
- Le volume total du jour est réparti entre les fronts **au prorata de leur importance
  topologique** : un goulot reçoit une part `horde.part_goulot` fois plus grosse.

**Offensives de fin d'acte** — aux jours 10, 20 et 30 :

- volume multiplié par `horde.multiplicateur_offensive`
- **Tous les lieux exposés sont attaqués simultanément**, quel que soit `nb_fronts`
- Un seul lieutenant prend la main. La liste des trois lieutenants est une
  **permutation propre** des doctrines actives, dérivée de la graine de lune sur un
  contexte indépendant (« lieutenants ») : l'ordre dans lequel les doctrines ont été
  tirées pour la lune n'entre pas dans cette permutation. Le lieutenant du jour est
  `lieutenants[acte − 1]` où `acte = ⌈jour/10⌉`. Il ordonne les exposés selon sa
  préférence, chaque exposé reçoit une vague.

---

## 8. Renseignement

**Règle générale : on voit parfaitement son propre état, mal celui du voisin, jamais les
intentions de l'ennemi.** Ne jamais masquer ce qui rendrait la décision du joueur
arbitraire.

| Source | Horizon | Ce qu'elle donne |
|---|---|---|
| Patrouille | Le soir même | Volume approximatif de la vague |
| Éclaireur | Le lendemain | Composition, pas l'abord visé |
| Espion PNJ | 2 jours | Une réponse exacte à **une** question |
| Surveillance des Fosses | Plusieurs jours | Volume des vagues à venir |

L'espion est commandé aujourd'hui pour un assaut de la semaine. Le travail du général est
d'anticiper **quelle sera la bonne question**.

**La bataille est elle-même une source** : elle révèle la composition exacte rencontrée sur
chaque abord. Une défaite achète de l'information.

---

## 9. Blessures et convalescence

- **Personne ne meurt.** Un joueur est blessé.
- Le blessé retourne au cœur, ne peut pas combattre, **libère son poste mais conserve son
  grade**.
- Durées `[calibrer]` : légère 6 h, sérieuse 18 h, grave 36 h.
- Il perd son équipement en tombant — chaque blessure est une commande passée aux ateliers.
  **C'est l'impulsion économique principale du jeu.**
- Le coût réel est payé par le royaume (un trou dans la ligne), pas par le blessé.

### Qui est blessé

Sont blessés uniquement les défenseurs des abords **ayant cédé**, à hauteur de
`blessures.part_des_pertes` (0.5 au départ) des pertes de cet abord.

Les pertes des abords tenus **ne produisent pas de blessés** — elles représentent l'usure
et le désordre, réintégrés à la garnison au round suivant.

### Sévérité

**Déterministe**, fonction de l'écart de force au moment de la rupture :

| Écart `F_assaillant / F_defenseur` | Sévérité |
|---|---|
| < `seuils_severite.serieuse` (1.5) | légère |
| entre 1.5 et `seuils_severite.grave` (3.0) | sérieuse |
| > 3.0 | grave |

### Escalade

Si le joueur a déjà été blessé dans les `fenetre_escalade_heures` (72 h), la durée de la
nouvelle blessure est multipliée par `escalade_facteur` (1.5). **Se cumule** à chaque
récidive dans la fenêtre.

Force la rotation des postes.

### Fin de lune

Une convalescence qui déborde la fin de lune est **annulée à la démobilisation**. Le
joueur repart sain au début de la lune suivante.

### Ce que fait le blessé

- Il produit des matériaux
- Il **génère un boost d'XP pour l'entraînement des recrues**, avec un nombre de places
  limité
- Il apprend auprès des PNJ : commandement, fortification, instruction, œil du métier,
  vétérance

### Règle anti-exploit

La blessure ne doit **jamais** être rentable.

- Le blessé ne progresse pas dans sa voie martiale pendant sa convalescence.
- La piste apprise au centre est **plafonnée par lune**, et ce plafond est calé sur ce
  qu'un joueur normalement exposé accumule sans le chercher. Se blesser exprès n'apporte
  rien.
- L'instruction progresse quand **l'élève** franchit un palier, jamais avec le temps passé.
  Infarmable par construction.

### Chiffre critique à surveiller

**Quelle proportion de vétérans se trouve au centre à un instant donné ?** Tout le pilier
de transmission en dépend. Si le résultat est trop bas, allonger la convalescence — jamais
augmenter le risque.

---

## 10. Grades et postes

### Échelle

`recrue` → `soldat` → `caporal` → `sergent` → `capitaine` → `general`

**L'échelle est tronquée par l'effectif.** Un grade est débloqué au-delà de N joueurs
actifs (mesure du §7) :

| Grade | Seuil d'effectif |
|---|---|
| `caporal` | 8 |
| `sergent` | 15 |
| `capitaine` | 40 |
| `general` | 60 |

### Grade et poste

- Le **grade** est une qualification personnelle. Il **persiste entre les lunes**, mais
  décroît d'un cran s'il n'est pas exercé pendant une lune entière.
- **Exercer un grade** = avoir tenu un poste de son grade **ou supérieur** pendant au
  moins **un acte complet** au cours de la lune. Évalué à la démobilisation. Cumulé sur
  la lune, pas d'affilée. À défaut, le grade décroît d'un cran.
- Le **poste** est rare, propre à la lune, et doit être vacant.
- Nombre de postes dérivé de l'effectif : un sergent par Feu de Guet, un capitaine par
  secteur, un ou deux généraux.
- Un blessé libère son poste. Son adjoint prend l'**intérim** et peut le conserver s'il a
  bien tenu.

### Attribution

- **Éligibilité par liste**, puis **élection** parmi les éligibles.
- La liste empêche le nouveau venu populaire ; l'élection empêche la dynastie du farmeur.
- Aucun des deux seul ne suffit.
- Mandat renouvelé **à chaque acte** (3 par lune).
- Plafond souple : pas trois lunes de suite au même poste.
- Les capitaines d'un secteur peuvent réclamer un changement de commandement (défiance).
- **Interdits** : tirage au sort, XP pur comme critère, désignation par le sortant.

### Actions par grade

| Grade | Actions spécifiques |
|---|---|
| `recrue` | Forger ; préparer vivres et convois ; réparer ; tenir un Feu de Guet en garnison ; s'entraîner auprès d'un blessé ; honorer une commande nominative |
| `soldat` | Tenir une position ; escorter un convoi ; participer à une sortie ; patrouiller ; entretenir les ouvrages ; relever un camarade |
| `caporal` | Mener une escouade ; réquisitionner du ravitaillement ; encadrer une recrue au feu ; tenir un point avancé ; faire remonter l'état du terrain ; organiser la relève |
| `sergent` | Fixer la posture de sa garnison ; lancer un appel au ravitaillement ; fortifier ; répartir l'équipement entrant ; décider de tenir ou d'évacuer ; nommer son adjoint |
| `capitaine` | Répartir les garnisons du secteur ; ordonner une sortie ; fixer les priorités de production ; recommander des promotions ; négocier avec les PNJ ; ordonner un repli |
| `general` | Fixer la priorité stratégique ; affecter les postes ; répartir l'effort entre secteurs ; commander les moyens rares ; décréter la mobilisation générale ; signer le bilan de la lune |

**Tout le monde combat, quel que soit le grade, et peut être blessé.** Ne jamais assouplir
cette règle pour le confort du commandement : c'est elle qui fait tourner les postes au
sommet.

**Intérim automatique** après quelques heures d'inactivité d'un officier `[calibrer]`.
Sans cela, une absence paralyse le royaume.

---

## 11. Progression

### Quatre mécanismes anti-farm, empilés

1. **L'XP suit le besoin du royaume.** Multiplicateur dynamique sur l'état réel : s'il
   manque des lames, forger paie davantage ; si un front est dégarni, le tenir paie
   davantage. L'optimum de farm coïncide avec l'utilité collective.
2. **L'ordre accompli paie un bonus** qu'aucune activité libre ne donne. Des ordres
   permanents sont générés par le système quand aucun officier n'est connecté.
3. **Satiété quotidienne** par activité, habillée en fatigue.
4. **L'XP est une barre, l'éligibilité est une liste.** Pour être éligible sergent, il faut
   avoir tenu une garnison, escorté un convoi, encadré une recrue, encaissé une blessure.
   **Chaque item d'une liste doit être atteignable depuis le grade inférieur** — à
   vérifier palier par palier.

### Source d'XP selon le grade

**Plus le grade monte, plus l'XP dépend du résultat collectif et moins de l'action
individuelle.**

| Grade | Payé sur |
|---|---|
| `recrue`, `soldat` | Ses actions, pondérées par le besoin |
| `caporal` | Ses actions et la tenue de son escouade |
| `sergent` | Le résultat de son point |
| `capitaine` | L'état de son secteur en fin d'acte |
| `general` | L'issue de la campagne |

Au-delà du caporal, le farm devient impossible : on ne farme pas un résultat.

### Formule de gain

```
gain = base_evenement
     × multiplicateur_besoin        (0.7 à 1.8, fonction de l'état du royaume)
     × bonus_ordre_accompli         (1.4 si l'événement satisfait un ordre)
     × ( satiete_restante > 0 ? 1 : 0.1 )
```

Les valeurs de `base_evenement` par type d'action vivent dans `config/balance.json` avec
des valeurs identiques au départ. **La simulation les différenciera, pas l'intuition.**

### Paliers

Géométriques : `seuil(n) = seuil_1 × r^(n-1)`, avec `r = progression.ratio_paliers`
(2.2 au départ).

### Montée et rattrapage

- **L'accès au front doit être rapide** : un joueur touche la Marche vers le jour 5-6.
- **La puissance ne se rattrape pas** : un Marcheur du jour 6 et un du jour 25 sont
  incomparables.
- Monter en niveau ne fait pas produire **plus**, ça fait produire **plus vite son dû**,
  donc ça libère du temps pour s'entraîner.
- Le passage sur la Marche est un événement **daté et public**.

---

## 12. Issues et persistance

### Trois issues

| Issue | Condition | Effet sur la lune suivante |
|---|---|---|
| Victoire décisive | Toutes les Fosses détruites avant la fin | Horde affaiblie, un PNJ spécialiste de plus, quelques ouvrages debout |
| Victoire défensive | Fin de lune, royaume debout | Statu quo, front inchangé |
| Défaite | Troisième chute de la place forte dans la lune | Horde renforcée, ravitaillement réduit, afflux de réfugiés (plus de bras, moins de vivres) |

**La défaite comprime, elle ne termine pas** — jusqu'à un plafond. Si la ligne cède en
cours de lune, on se replie sur un périmètre plus serré et la campagne continue. Une
lune va au bout de ses 30 jours **sauf** si le plafond de compressions est franchi.

### Compression après chute de la place forte

**On ne régénère pas la carte.** À la chute de la place forte :

1. Le `feu_de_guet` tenu **le plus éloigné des entrées** devient **place forte
   provisoire**.
2. Tous les lieux non reliés à ce pivot par un chemin de **routes tenues** sont perdus.
3. Les garnisons de ces lieux sont repliées sur le pivot, avec une **blessure sérieuse**.

La compression peut avoir lieu **au maximum `compression.max_par_lune`** fois (2). À la
troisième chute, la province est perdue et la lune se termine par une défaite, quel
que soit le jour.

### Ce qui traverse

**Le royaume se souvient, le joueur presque pas.**

- Collectivement : état du front, puissance de Varhal, provinces, PNJ survivants, Annales.
- Individuellement : un titre, un rang de qualification, une réputation. **Jamais de la
  puissance.**

### Vocabulaire à respecter

Jamais « réinitialisation », « remise à zéro », « perte ». Dire *la lune s'achève*,
*la campagne est close*, *démobilisation*.

Le rang porte toujours sa portée : *Marcheur — lune de Loncrête*, jamais « Niveau 40 ».
La date de fin de lune est visible dès le premier écran.

À la fin, **ne jamais montrer ce qu'on perd** : montrer ce qui vient.

Le joueur **choisit son fragment** parmi 3 ou 4 options équivalentes. Un dépouillement subi
et une sélection décidée produisent des ressentis opposés.

Un écran **qui n'est jamais remis à zéro** doit exister dès la v1 : campagnes faites,
provinces défendues, élèves formés, titres, batailles.

---

## 13. Identité et récit

- **Origine** : à l'inscription, le joueur choisit d'où il vient et pourquoi il a pris les
  armes. Son origine est **une province du royaume**. Quand elle tombe, c'est chez lui.
  Inclinaison mécanique minuscule, jamais un avantage.
- **Quête personnelle secrète** par lune, connue de lui seul. Se réalise **en obéissant**.
- **Bannière** héraldique composable. Seule monétisation admise : nouvelles charges et
  partitions, zéro effet sur l'équilibre.
- **Tableau des missions** : missions publiques affichées par la hiérarchie, paramétrées
  par l'état réel du royaume. Branché sur le bonus d'XP à l'ordre accompli.
- **Legs** : en fin de lune, celui qui a tenu un lieu y inscrit un texte de son choix,
  définitivement.
- **Les lieux gardent le nom de ceux qui les ont tenus**, et ce nom entre aux Annales.

### Interdit

**Aucun rôle caché, aucun traître.** Sur quatre semaines avec des inconnus, la trahison
détruit la confiance qui est le socle de tout le design.

---

## 14. Anti-patterns sociaux

- **Ne jamais exposer publiquement la contribution individuelle.** Un classement de
  production est un tableau d'affichage de la honte. L'échec doit être attribuable au
  système, jamais à une personne.
- **Plafonner le joueur hyperactif** : nombre de lieux tenus, actions par jour. Brider le
  meilleur protège les vingt autres.
- **Passation de commandement formelle** en cas d'absence annoncée, avec ordres permanents.
- **Le minimum vital doit fonctionner sans Discord** : signaler un point en danger,
  réclamer du ravitaillement, accepter une commande.
- **Affectation, pas marché** : une recrue rejoint une section avec un sergent nommément
  responsable d'elle. Un marché de commandes libres peut exister par-dessus, jamais à la
  place.
- **Échelles de prestige parallèles** : commandement, instruction, ténacité, forge, renom
  martial. Aucune subordonnée aux autres. C'est ce qui empêche la course au galon.
- **Le général n'est pas le plus puissant** : il joue à autre chose. Sa contribution
  martiale personnelle diminue.
- **Aucun avantage payant, jamais.** L'équité collective est le socle du design.
