# Lore de CulturiaQuests — la bible du monde

Ce document est la **source de vérité narrative** du projet. Il décrit l'univers, ses factions et
la façon dont chaque mécanique de jeu se traduit en fiction.

Il complète [`architecture.md`](./architecture.md), qui décrit la technique et ne parle jamais du
monde. Les fiches détaillées des personnages vivent dans
[`lore-personnages.md`](./lore-personnages.md).

> **Pourquoi ce fichier existe** : le lore vivait sur un Notion devenu introuvable. Ce qui suit a
> été reconstitué à l'oral et validé point par point. Toute évolution du monde se consigne ici, dans
> le même commit que le contenu qui l'a provoquée.

---

## 1. Le monde

**Culturia** est un royaume médiéval-fantastique qui couvre **le monde entier** — pas un pays, pas
une région. Le jeu étant géolocalisé, les lieux réels *sont* ceux de Culturia : il n'y a pas de
géographie parallèle à inventer, et aucune province n'est nommée. Le flou est volontaire.

Le royaume est **en guerre depuis quelques décennies** — assez pour que les enfants d'alors soient
aujourd'hui des vieillards.

### Monarque

Le royaume est gouverné par **Monarque**. C'est une femme. **Personne ne l'a jamais vue**, et
beaucoup doutent qu'elle existe encore.

Cette invisibilité est **une défense** : on a déjà comploté contre elle (Denrick le Forgeron a perdu
un œil en déjouant l'un de ces complots, et passe pour l'un des rares à l'avoir aperçue). Nul ne
peut frapper ce qu'il ne trouve pas.

### L'armée royale

**Exsangue.** Décimée par des décennies de guerre, elle ne tient plus grand-chose. C'est pour cela
que la couronne a dû mandater les guildes : il ne restait personne d'autre pour aller aux brèches.

---

## 2. L'ennemi

### Le miroir de Monarque

En face se tient **une souveraine symétrique et opposée** — un miroir de Monarque, avec ses **seize
fidèles** face aux seize héros du royaume. C'est de là qu'est venue l'ouverture des brèches : elles
n'ont pas percé toutes seules, **quelqu'un les a ouvertes**, délibérément, en visant ce qui tient un
peuple debout.

### Les brèches

Elles se sont ouvertes **dans les musées** — les lieux les plus importants du royaume. Elles ne se
referment pas. Une expédition victorieuse **repousse sans jamais sceller** : on gagne du répit, on
revient toujours.

Au sommet d'un bastion se trouve **le cœur de la brèche**, l'endroit où elle perce. On ne peut pas
l'éteindre, mais s'en approcher permet de la contenir un temps. C'est la raison pour laquelle on
**monte** — jamais on ne « descend » dans un bastion.

### Les créatures

Une **pyramide**, dans l'esprit des peaux-vertes de Warhammer :

- à la base, une masse instinctive et sans stratégie, du genre gobelin ;
- au-dessus, des chefs plus forts auxquels cette masse obéit, et ainsi de suite en remontant ;
- au sommet, les **seize antagonistes**, pleinement conscients et intelligents.

### L'arme : l'effacement des mémoires

Ils ne pillent pas l'or et ne brûlent pas les toiles. **Ils effacent les mémoires.** Les œuvres
restent en place, mais plus personne ne se souvient de ce qu'elles signifient.

C'est le cœur thématique du jeu : dans Culturia, **se souvenir est un acte de résistance**.

### L'accalmie

Les incursions se font rares depuis plusieurs années. Ce n'est pas une victoire : **c'est le calme
avant l'offensive.** Les seize antagonistes préparent quelque chose, et le compte à rebours court.

---

## 3. Les guildes et le joueur

Les guildes sont **mandatées par le trône** : une charte royale les autorise à lever des expéditions
contre les brèches. Ce mandat est né de la faiblesse de l'armée, pas de sa générosité.

**Le joueur est un maître de guilde.** Son passé n'est pas écrit — page blanche assumée, pour que
chacun s'y projette. Il hérite de la guilde de **Théodric Vaelmont, dit « le Vieux Maître »**, un
personnage à part qui n'appartient ni aux seize héros ni aux seize civils, et qui lui transmet la
charge avant de se retirer. C'est lui qui narre le tutoriel d'accueil.

**Les autres joueurs sont d'autres maîtres de guilde**, dans le même monde. Alliés de fait contre
les brèches, même sans se coordonner — ce qui fonde le système d'amis et le quiz partagé.

Le **siège de la guilde** est un bourg : c'est là que vivent les seize civils, et c'est ce qui rend
lisibles leurs liens et leurs rivalités (Bram et Denrick, Toben et Joric, Toren et Malori).

---

## 4. Les trois cercles de seize

| Cercle | État d'écriture | Rôle |
|---|---|---|
| **16 civils** | Écrits | Habitants du siège de la guilde. Donneurs de quêtes, et le cœur humain du jeu. |
| **16 héros** | À écrire | Vétérans des premières brèches, aujourd'hui vieux — certains ne sont plus de ce monde. **Non recrutables** : ce sont des figures de récit, rencontrées en quête et surtout dans le journal. |
| **16 antagonistes** | À écrire | Fidèles du miroir de Monarque. **Adversaires de récit**, pas gardiens de bastion : ils mènent la guerre à l'échelle du royaume. |

Les personnages **recrutés** par le joueur sont des **compagnons anonymes** (Héros, Mage, Archer,
Soldat) — jamais les seize héros nommés.

Noms et fiches : [`lore-personnages.md`](./lore-personnages.md).

---

## 5. Traduction des mécaniques en fiction

Toute mécanique visible du joueur doit avoir sa justification ici. C'est la table à consulter avant
d'écrire un texte d'interface.

| Mécanique | Dans la fiction |
|---|---|
| **Musées** | Les **bastions** : des musées où une brèche est ouverte et où les créatures campent. |
| **Expédition, paliers** | On **monte** vers le cœur de la brèche pour la contenir. Plus haut = plus dangereux, et ce qu'on arrache à l'effacement a plus de valeur. |
| **POI (statues, monuments, églises)** | À la fois des **ancrages de mémoire**, entretenus pour résister à l'effacement, et des **caches de guilde** où l'on se ravitaille. |
| **Coffre, 50 m, 24 h** | La cache ne se laisse pas raconter d'histoires : il faut y être. Elle se regarnit chaque jour. |
| **Brouillard** | Les **terres non relevées** : la carte de la guilde est incomplète, ce qui n'a pas été arpenté n'est pas dessiné. Explication cartographique, sans charge symbolique. |
| **Quiz quotidien** | L'**entraînement à la mémoire** : puisque l'ennemi efface, la guilde exerce ses maîtres à retenir. |
| **Équipement** | **Rapporté des bastions** (butin) puis **travaillé à la forge** — amélioration et recyclage sont l'œuvre de Denrick le Forgeron. |
| **Journal** | Les récits **des gens eux-mêmes**, recueillis par la guilde. C'est aussi la seule présence des héros disparus. |
| **Guilde, or, niveau** | Le renom de la maison dont le joueur a hérité. |
| **Régions / départements / comcoms** | **Purement technique.** Aucun pendant narratif : ne pas tenter d'en inventer un. |

---

## 6. Règles d'écriture

À respecter dans tout texte destiné au joueur (dialogues, tutoriel, interface) :

- On **monte** un bastion. Jamais « descendre », jamais « donjon », jamais « sanctuaire ».
- Un niveau de bastion est un **palier**, jamais un « étage ».
- Le joueur **est** maître de guilde. Ne jamais l'écrire comme une recrue ou un aventurier.
- Les musées envahis sont des **bastions** ; les brèches ne se **referment** jamais.
- L'ennemi **efface**, il ne brûle pas et ne pille pas.
- Monarque est **une femme**, invisible, et son existence même est un sujet de doute.
- Ne jamais nommer Saint-Lô ni la France : le royaume est **Culturia**, et il est le monde.
- Les seize héros sont **vieux**, et l'on parle d'eux au passé plus souvent qu'au présent.

---

## 7. Zones ouvertes

Points volontairement non tranchés. À compléter ici même dès qu'ils le seront.

- **Théodric Vaelmont** — nom arrêté, mais son histoire reste à écrire : d'où il vient, comment il
  a tenu la guilde pendant la guerre, pourquoi il se retire maintenant. Ses visuels manquent (#177).
- **Le nom du miroir de Monarque**, et la nature exacte de sa symétrie avec elle.
- **Le nom du bourg** qui sert de siège à la guilde.
- **Les seize héros** : noms arrêtés, biographies à écrire.
- **Les seize antagonistes** : tout reste à écrire, y compris la façon dont le joueur les croise.
- **Le mécanisme de l'effacement** : progressif ou brutal, réversible ou non, perceptible par les
  habitants ou non.
