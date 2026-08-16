# Installation

Monter HomeCycl'Home sur un poste de développement, du clone au serveur qui
répond.

Toutes les commandes de ce guide ont été exécutées lors de sa rédaction, sur un
poste Windows 11, la plupart depuis un **clone neuf** pour ne pas hériter de
l'état d'un dépôt déjà monté. Les rares étapes non rejouées portent la mention
**non vérifié** et disent ce qui manquait pour les prouver. Aucune n'est
présentée comme validée sans l'être.

## 1. Prérequis

Versions constatées sur le poste de rédaction. Le dépôt n'a été exercé qu'avec
celles-ci.

| Outil   | Version constatée           | Contrainte du dépôt                        | Contrôle           |
| ------- | --------------------------- | ------------------------------------------ | ------------------ |
| Node.js | `v24.15.0`                  | `engines.node: ">=24"` dans `package.json` | `node -v`          |
| pnpm    | `10.33.2`                   | `packageManager: "pnpm@10.33.2"`           | `pnpm -v`          |
| Git     | `2.54.0.windows.1`          | aucune                                     | `git --version`    |
| Docker  | CLI `29.5.3`                | **facultatif**, cf. §9                     | `docker --version` |
| OpenSSH | fourni avec Git for Windows | accès au tunnel                            | `ssh -V`           |

Node 24 n'est pas un caprice de version. Node 22 est en maintenance depuis le
21/10/2025 et meurt le 30 avril 2027 ; la chaîne a été alignée sur 24 plutôt que
de descendre le poste.

**pnpm est obligatoire, pas préféré.** Le dépôt déclare `onlyBuiltDependencies`
dans `pnpm-workspace.yaml`, mécanisme propre à pnpm 10 sans lequel six paquets ne
compilent pas leur binaire. npm et yarn ne le lisent pas.

Docker n'est nécessaire ni pour développer ni pour lancer les tests unitaires.
Il ne sert qu'aux tests E2E de barrière et à la construction de l'image. Voir §9.

## 2. Cloner

**Sur Windows, la fin de ligne se décide au clone, pas après.** L'installeur Git
for Windows pose `core.autocrlf = true` au niveau système, tandis que
`.editorconfig` impose `end_of_line = lf` à tout le dépôt. Sans précaution, le
clone sort intégralement en CRLF et chaque passage de Prettier réécrit les
fichiers.

Mesuré au moment de la rédaction, sur `src/lib/env.ts` : clone par défaut,
**155 lignes sur 155 en CRLF**. Même clone avec le drapeau ci-dessous, **0**.
L'origine du réglage est vérifiable :

```bash
git config --show-origin --get core.autocrlf
```

Ce qui répond `file:C:/Program Files/Git/etc/gitconfig  true`, donc ni le dépôt
ni le profil utilisateur.

D'où le clone en une seule commande, `-c` étant persisté dans la configuration
locale du clone créé :

```bash
git clone -c core.autocrlf=false https://github.com/BenSTAU/hch.git
```

**Si le clone existe déjà et sort en CRLF**, le réglage seul ne suffit pas : il
faut redemander la copie de travail. Séquence vérifiée, arbre propre à
l'arrivée :

```bash
git config core.autocrlf false
```

```bash
git rm --cached -r . && git reset --hard
```

Le `git rm --cached` ne touche pas aux fichiers, il vide l'index pour que le
`reset` réécrive la copie de travail avec la nouvelle règle.

Sur Linux et macOS, `core.autocrlf` vaut `input` ou rien, et la question ne se
pose pas. **Non vérifié** : aucun poste Unix disponible en session.

## 3. Installer les dépendances

```bash
pnpm install --frozen-lockfile
```

38,4 s sur clone neuf. `--frozen-lockfile` est la forme utilisée en CI ; en local
elle a le mérite d'échouer si `pnpm-lock.yaml` et `package.json` ont divergé,
plutôt que de résoudre en silence.

**Cette commande se termine sur un avertissement, et il n'est pas décoratif :**

```
Ignored build scripts: @prisma/engines@6.19.2.
Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
```

pnpm 10 n'exécute aucun script d'installation sans autorisation explicite. Le
dépôt en autorise six dans `pnpm-workspace.yaml` (`@prisma/client`, `prisma`,
`bcrypt`, `esbuild`, `sharp`, `lefthook`), **et cela ne couvre pas
`@prisma/engines`**, qui est tiré en dépendance transitive. Le client Prisma
n'est donc pas généré à ce stade.

`pnpm approve-builds` est interactif, donc inutilisable en CI : ne pas l'appeler.
L'étape suivante règle le problème.

## 4. Générer le client Prisma

**Cette étape ne se fait pas toute seule et l'oublier coûte une demi-heure de
diagnostic.**

```bash
pnpm exec prisma generate
```

Elle ne demande aucune base de données et fonctionne sans `.env.local`, ce qui
permet de la placer ici, avant toute configuration.

### Le faux positif à connaître

`pnpm exec prisma -v` **répond** sur un clone où le client n'existe pas :

```
prisma                  : 6.19.2
@prisma/client          : 6.19.2
```

Ces deux lignes prouvent le **CLI**, pas le **client** : ce sont deux artefacts
distincts. Vérifié en session, immédiatement après `pnpm install` et avant
`prisma generate`, cette commande répondait pendant que le client échouait sur :

```
Cannot find module '.prisma/client/default'
```

Le contrôle qui prouve réellement quelque chose porte sur le client lui-même :

```bash
node -e "const {PrismaClient}=require('@prisma/client'); new PrismaClient(); console.log('client OK')"
```

Après `prisma generate`, il affiche `client OK`. Le symptôme que produit l'oubli,
lui, apparaît au premier `prisma db seed` : `did not initialize yet`.

## 5. Variables d'environnement

Copier le modèle, puis renseigner. Le modèle est commité et **vide de valeurs**,
comme `.env.prod.example` pour les piles VPS.

```bash
cp .env.example .env.local
```

`.env.local` est ignoré par Git et **c'est le seul fichier qui diffère entre deux
postes**. Il n'a pas à être synchronisé.

Les valeurs ne figurent nulle part dans ce dépôt et ne sont pas reproduites ici.
Elles se demandent à Benjamin, ou se lisent dans le `.env.prod` de la pile
concernée sur le VPS, hors dépôt.

| Nom                   | Exigée quand                                     | Lue par                              |
| --------------------- | ------------------------------------------------ | ------------------------------------ |
| `DATABASE_URL`        | **toujours**                                     | `src/lib/env.ts`, `prisma.config.ts` |
| `SESSION_SECRET`      | **toujours**                                     | `src/lib/env.ts`                     |
| `HCH_MAIL_TRANSPORT`  | **toujours**, valeur `gmail` ou `noop`           | `src/lib/env.ts`                     |
| `GMAIL_APP_PASSWORD`  | si `HCH_MAIL_TRANSPORT=gmail`                    | `src/lib/env.ts`                     |
| `GMAIL_FROM_ADDRESS`  | si `HCH_MAIL_TRANSPORT=gmail`                    | `src/lib/env.ts`                     |
| `NEXT_PUBLIC_APP_URL` | si `HCH_MAIL_TRANSPORT=gmail`, facultative sinon | `src/lib/env.ts`                     |
| `SEED_ADMIN_PASSWORD` | pour lancer le seed                              | `prisma/seed.ts`                     |
| `HCH_MAPS_API_KEY`    | facultative                                      | `src/lib/env.ts`                     |
| `HCH_BAN_BASE_URL`    | **ne pas renseigner**, cf. ci-dessous            | `src/lib/geo/ban.ts`, à l'appel      |

Aucun défaut n'est posé sur `HCH_MAIL_TRANSPORT`, délibérément : un repli
silencieux sur `noop` ferait qu'une pile mal configurée cesserait d'envoyer ses
emails sans que rien ne le signale.

### La variable qu'il ne faut pas renseigner

`HCH_BAN_BASE_URL` est une **variable d'injection de barrière**. Elle n'existe
que pour rendre l'appel sortant vers la Base Adresse Nationale interceptable
pendant les tests E2E, et elle est posée uniquement par `playwright.config.ts` en
local et par `docker-compose.test.yml` en CI.

Renseignée sur un poste ou sur une pile, elle détournerait le géocodage vers un
faux service. C'est pourquoi elle est absente de `src/lib/env.ts` et de
`.env.prod.example` : une variable proposée finit par être remplie. Elle est lue
**à l'appel** et non au chargement du module, avec repli sur l'URL réelle, de
sorte que non renseignée elle soit inerte.

## 6. Ports

| Port   | Ce qui écoute                                                 | Où              |
| ------ | ------------------------------------------------------------- | --------------- |
| `3000` | l'application, `pnpm dev` comme `pnpm start`                  | poste           |
| `5433` | **entrée locale du tunnel SSH** vers la base de développement | poste           |
| `5434` | `hch-postgres-dev`, publié sur `127.0.0.1` côté serveur       | VPS             |
| `5435` | `hch-postgres-test`, monté par `docker-compose.test.yml`      | poste, éphémère |

`DATABASE_URL` de développement vise donc `localhost:5433`, jamais `5434`
directement : le port du VPS n'est pas exposé à internet, et c'est intentionnel.
Docker contourne UFW, ses ports publiés étant traduits dans `PREROUTING` sans
jamais traverser `INPUT` ; un `ports: "5434:5432"` sans préfixe `127.0.0.1:`
exposerait la base sans qu'aucun `ufw status` ne le signale.

## 7. Ouvrir le tunnel

**La base de développement est unique et distante.** Les deux postes de
développement attaquent la même, sur le VPS. Il n'y a pas de base locale à
monter, et il ne doit pas y en avoir : deux installations PostGIS susceptibles de
diverger, sur un projet dont le coeur métier est `ST_Covers` et un index
`EXCLUDE USING gist`, produiraient le pire des scénarios, celui où ça marche sur
un poste et pas sur l'autre.

Dans une **fenêtre PowerShell dédiée**, gardée ouverte toute la session :

```bash
ssh -N -L 5433:127.0.0.1:5434 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes glanfordDeploy
```

`-N` n'ouvre pas de shell : **l'absence totale d'affichage est le comportement
normal**, pas un blocage. `glanfordDeploy` est l'alias `~/.ssh/config` du compte
`deployer` ; l'alias `glanford` pointe sur un autre compte et n'a rien à faire
ici.

Contrôle, depuis une **autre** fenêtre :

```bash
Test-NetConnection localhost -Port 5433
```

`TcpTestSucceeded : True` et le tunnel est debout.

Garder `connection_limit=5` dans `DATABASE_URL`. Chaque connexion Prisma est un
canal multiplexé dans le tunnel : élargir le pool dégrade la latence au lieu de
l'améliorer. La latence médiane mesurée sur ce tunnel est de 75 ms.

## 8. Migrer, semer, lancer

Le tunnel doit être ouvert pour les trois commandes de cette section.

État des migrations, en lecture seule :

```bash
pnpm exec prisma migrate status
```

Réponse obtenue : `16 migrations found in prisma/migrations` puis
`Database schema is up to date!`.

Application des migrations :

```bash
pnpm exec prisma migrate deploy
```

Réponse obtenue : `No pending migrations to apply.` La base partagée était déjà à
jour ; **non vérifié**, le comportement de cette commande sur une base vierge,
faute d'en avoir une à sacrifier.

`migrate deploy` est la commande de CI et de production. En local, `migrate dev`
est l'équivalent qui crée les fichiers de migration ; il peut proposer un reset
sur cette base partagée, sans conséquence puisque personne d'autre n'y travaille.
**Non vérifié en session** : la lancer aurait risqué un reset de la base de
développement pendant la rédaction de ce guide.

Référentiel de départ :

```bash
pnpm exec prisma db seed
```

Sortie obtenue, rejouable par upsert sur une base déjà peuplée :

```
administrateur  admin@homecyclhome.fr
administrateur  admin2@homecyclhome.fr
paramètres      12 clés société
villes          9 arrondissements de Lyon
zone            Lyon (12 sommets)
technicien      tech@homecyclhome.fr → zone Lyon
forfaits        3 au catalogue
produits        3 au catalogue
```

Le seed échoue explicitement si `SEED_ADMIN_PASSWORD` est absente : aucun mot de
passe n'est écrit en dur, le dépôt étant public.

Lancer :

```bash
pnpm dev
```

Contrôle de bout en bout, qui prouve à la fois le serveur, la garde
d'environnement et la base :

```bash
curl http://localhost:3000/api/health
```

Réponse obtenue en session : `200` et `{"status":"ok","db":true}`. Un `503`
portant `{"status":"degraded","env":false}` désigne une variable manquante ; un
`503` portant `{"status":"degraded","db":false}` désigne la base, donc le plus
souvent le tunnel.

## 9. Docker, et quand il ne sert pas

Rien de ce qui précède n'a besoin de Docker. Deux usages seulement l'exigent :

| Usage                 | Fichier                   | Nécessite le daemon |
| --------------------- | ------------------------- | ------------------- |
| tests E2E de barrière | `docker-compose.test.yml` | oui                 |
| image de production   | `Dockerfile`              | oui                 |

L'un des deux postes de développement du projet est une machine virtuelle où la
virtualisation imbriquée n'est pas disponible : **Docker ne peut pas y tourner**.
Avant de proposer une commande `docker`, constater :

```bash
docker info
```

```bash
test -d "/c/Program Files/Docker"
```

Les deux se lisent ensemble, et dans cet ordre. `docker info` répond : daemon
actif. Il échoue mais le répertoire existe : Docker est installé, simplement
arrêté, le démarrer. Il échoue et le répertoire est absent : poste sans Docker,
ne pas insister.

Conclure « pas de Docker » sur le seul échec de `docker info` est un faux positif
constaté. `docker compose version` en est un autre, plus trompeur encore : il
répond sur un poste où le daemon est absent, la CLI étant installée seule.

**Non vérifié en session** : les commandes `docker compose` et
`pnpm test:e2e`. Le daemon était arrêté au moment de la rédaction, seule la CLI
répondait (`docker --version` a rendu `29.5.3`). Il n'y a **aucun**
`docker-compose.dev.yml` dans ce dépôt, et il ne doit pas y en avoir : la base de
développement est distante, cf. §7.

## 10. Contrôles

Les cinq commandes que la CI exécute. Toutes lancées en session, sur le dépôt de
travail.

| Commande         | Résultat obtenu                                     |
| ---------------- | --------------------------------------------------- |
| `pnpm lint`      | code de sortie 0, un avertissement `no-unused-vars` |
| `pnpm typecheck` | code de sortie 0                                    |
| `pnpm test`      | **115 fichiers, 1706 tests**, tous verts, 32,19 s   |
| `pnpm build`     | code de sortie 0, 22 routes listées                 |
| `pnpm test:e2e`  | **non vérifié**, daemon Docker arrêté               |

`pnpm build` aboutit **sans base de données ni tunnel** : la sonde `/api/health`
est en `force-dynamic` et n'est donc pas évaluée à la construction. C'est la même
propriété qui permet au stage builder du `Dockerfile` de fonctionner sans aucune
variable d'environnement.

`pnpm typecheck` appelle `next typegen` avant `tsc --noEmit`. Les types de
routage (`PageProps`, `LayoutProps`) sont générés par Next dans `.next/types/` et
`tsc` échoue sans eux sur un arbre jamais buildé.

## 11. Pannes fréquentes

Rangées par le symptôme littéral, celui qu'on lit dans le terminal.

### `Ignored build scripts: @prisma/engines@6.19.2.`

**Attendu**, sur tout `pnpm install`. pnpm 10 n'exécute aucun script
d'installation sans autorisation. Ce n'est pas la panne, c'est l'annonce de la
suivante.

**Correctif** : `pnpm exec prisma generate` (§4). Ne pas lancer
`pnpm approve-builds`, il est interactif.

### `did not initialize yet` au premier `prisma db seed`

Le client Prisma n'a pas été généré. Voir ci-dessus. Ne pas se laisser rassurer
par `prisma -v`, qui répond quand même : il prouve le CLI, pas le client (§4).

### `Cannot find module '.prisma/client/default'`

Même cause, vue depuis le code applicatif au lieu du CLI. Même correctif.

### `ECONNREFUSED 127.0.0.1:5433`

### `P1001: Can't reach database server`

### Prisma qui expire sans message

**Soupçonner le tunnel avant le code.** Ces trois symptômes ne sont presque
jamais une erreur de configuration Prisma sur ce projet.

**Contrôle** : `Test-NetConnection localhost -Port 5433`. Si `TcpTestSucceeded`
vaut `False`, le tunnel est tombé. Le relancer (§7) et ne rien modifier dans le
projet.

### `{"status":"degraded","env":false}` sur `/api/health`, en 503

Une variable d'environnement manque. La réponse HTTP ne dit pas laquelle,
délibérément : cette route est publique en production. **Le nom des variables
fautives est dans les journaux du serveur**, préfixé `[health] environnement
incomplet`, et elles y sont toutes nommées d'un coup.

### `{"status":"degraded","db":false}` sur `/api/health`, en 503

La base est injoignable. En développement, c'est le tunnel neuf fois sur dix.

### Erreur `Blocking Route` au rendu

Un composant serveur touche une source runtime (`params`, `cookies`, `headers`,
`searchParams`) ou fetch, sans `"use cache"` ni `<Suspense>` autour. Next 16
refuse le rendu. Poser l'un ou l'autre ; sur une lecture qui dépend d'une
variable d'environnement runtime, ce doit être `<Suspense>`, jamais `"use cache"`.

### Fichiers entiers marqués modifiés sans qu'on y ait touché

Fin de ligne. Le clone est sorti en CRLF. Voir la séquence de réparation en §2.

### `docker info` échoue

Voir §9 : cela ne dit pas si le daemon est arrêté ou absent. Lire le second
contrôle avant de conclure.

## Voir aussi

- [`README.md`](../README.md) : ce que fait le produit, la stack, les commandes.
- [`docs/api.md`](./api.md) : les routes HTTP et les Server Actions.
- Le vault Obsidian compagnon pour les artefacts de conception, dont
  `setup-poste-hch` qui décrit le dispositif à deux postes. Chemin et rôle dans
  [`CLAUDE.md`](../CLAUDE.md).
