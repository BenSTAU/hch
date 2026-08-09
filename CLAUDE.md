# HomeCycl'Home — repo code

Marketplace de réparation vélo à domicile — le technicien se déplace, le client
réserve en self-service, le paiement est encaissé sur le terrain. Projet fil
rouge de la certification CDA ([[rncp-37873|RNCP 37873]]), client fictif
LeCycleLyonnais.

## Le vault fait foi

Tous les artefacts de conception vivent dans le vault Obsidian compagnon, sous
`<racine-du-vault>\wiki\ecole\homecyclhome\`. La racine **dépend du poste** (cf.
§Deux postes de développement) — constater, ne pas supposer :

| Poste | Racine du vault |
|---|---|
| PC maison | `C:\Users\User\vault\` |
| PC Shadow | `C:\Users\Shadow\obsidian-vault\` |

| Chemin | Rôle |
|---|---|
| `spec-kit/01-constitution-hch.md` | 13 axiomes non négociables du produit — **lire en premier** |
| `spec-kit/02-spec-hch.md` + `02-spec-hch/` | 66 US, critères Given/When/Then, 5 modules |
| `spec-kit/03-plan-hch.md` + `03-plan-hch/` | Architecture : S1 stack, S2 MCD, S3 infra/CI, S4 non-fonctionnel |
| `spec-kit/04-tasks-hch.md` + `04-tasks-hch/` | Découpe exécutable, format `T-J0-04`, DoD par tâche |
| `adr/` | 19 ADR — décisions tranchées, certaines archivées ou caduques (le titre le dit) |
| `mcd-dictionnaire.md` | Dictionnaire de données v2.2, 18 tables — fait foi sur le modèle |
| `livrables/livrables-hch.md` | État des 11 livrables imposés — fait foi sur ce qui reste à produire |
| `livrables/maquettage.md` | 22 écrans + **§Notes portage** : divergences maquette ↔ SPEC à corriger |
| `livrables/macro-planning-hch.md` | Sprints, bornes calendaires, règle de débordement |
| `points-ouverts-hch.md` | Questions encore ouvertes |
| `projet_homecyclhome.md` | Fil rouge narratif, chronologie datée |
| `phase-a/` | L'avant-pivot Spec Kit — audit trail, **jamais l'état courant** |

Wikilinks `[[basename]]` : résoudre par recherche du basename sous ce chemin.

## Tu es la session repo

[[adr-013-cadre-ia|ADR-013]] §D1 cloisonne deux sessions. Tu es celle du repo :
tu implémentes, tu testes, tu ouvres des PR. **Tu ne modifies jamais le vault.**
La propagation se fait après merge, par [[writeback-vault|writeback]], depuis la
session vault.

Raison : un assistant qui conçoit et implémente dans le même contexte rationalise
ses propres choix de conception au moment de coder.

## Trois doctrines non négociables

Elles viennent d'[[adr-013-cadre-ia|ADR-013]] §D2 et répondent au mode d'échec
dominant d'un assistant de code — non pas produire du code faux, mais affirmer
avec aplomb des choses plausibles et non vérifiées, puis diverger de la
conception sans le signaler.

### 1. Lecture du vault avant proposition

- **MUST** — lire les ADR et la section de PLAN qui couvrent le sujet **avant**
  toute proposition d'architecture, de découpage ou de choix technique. Le vault
  n'est pas optionnel, c'est l'entrée.
- **MUST** — toute divergence entre le code et ce qu'inscrit le vault
  (Constitution / SPEC / PLAN / ADR) est **remontée à Benjamin avant écriture**.
  Jamais absorbée en silence, jamais reléguée en « Notes ».
- **MUST NOT** — ne jamais proposer un changement de modèle de données sans
  avoir lu [[mcd-dictionnaire]] et [[s2-mcd-data|PLAN S2]] dans la session
  courante.

### 2. Cite or don't claim

- **MUST** — toute affirmation non triviale sur le code est suivie de sa
  référence **chemin + lignes** : `(src/lib/auth/dal.ts:42-58)`.
- **MUST NOT** — jamais décrire une API, un composant ou un comportement runtime
  absent du HEAD courant. Sans citation possible, écrire :
  `> [!todo-verify] <ce qui manque pour confirmer>`.
- **MUST NOT** — jamais citer une doc externe sans la matérialiser dans
  `docs/external/` ou dans le vault.
- **DEFAULT** — pour un artefact du vault, le wikilink `[[basename]]` suffit,
  sans numéro de ligne.

### 3. Body de PR à trois champs

Toute PR décrit :

1. **Livré** — ce qui est fait, coché contre la DoD de la tâche.
2. **Reporté** — vers une **tâche cible nommée**. Jamais un report qui ne se
   termine nulle part.
3. **Divergences** — tout écart constaté vis-à-vis de la DoD ou d'un ADR.

## L'agent testeur est cloisonné

[[adr-013-cadre-ia|ADR-013]] §D3 confie la vérification à un **agent distinct**,
dont les permissions interdisent d'écrire le code qu'il teste.

| Domaine | Droit |
|---|---|
| Lecture | code source, SPEC, tests existants, diff Git, doc |
| Écriture | `src/**/*.test.ts` et `src/**/*.test.tsx` (unitaires **co-localisés**) · `tests/**` (E2E) — rien d'autre |
| Exécution | Vitest, Playwright, Git en **lecture seule** — liste blanche, sans chaînage ni redirection |
| Interdit | tout `src/` **hors `.test.*`**, `prisma/`, configuration racine, `.env*`, `.github/`, `Dockerfile` |
| Sortie | constats, tests, recommandations — **jamais de correction de code** |

L'interdiction est appliquée par un hook `PreToolUse` déclaré dans
`.claude/settings.json` — **pas dans le frontmatter de l'agent, qui n'est jamais
lu**. Il couvre **`Bash` autant que `Write`/`Edit`** : un garde qui ne filtre que
les outils d'écriture se contourne par une redirection shell. Chaque refus est
journalisé dans `.claude/logs/` — un testeur qui tente de sortir de son périmètre
est un signal.

Un hook de `settings.json` s'applique à toute la session et **ne distingue pas**
le sous-agent de toi (`session_id`, `transcript_path`, `prompt_id` identiques).
D'où la **sentinelle** : deux hooks sur `Task|Agent` posent puis retirent
`.claude/.testeur-actif`, et le garde se retire d'emblée sans lui. La fenêtre où
il mord est exactement celle où l'étape 6 t'interdit déjà d'écrire.
**Fail-closed** : si le désarmement ne tourne pas, le garde reste actif et tes
écritures sont bloquées — pénible mais visible, et c'est voulu.

> **Ce que le garde fait, et ce qu'il ne fait pas.** Il **borne l'accident et rend
> l'intention visible**. Il n'arrête pas un agent décidé : le périmètre autorisé
> (`src/**/*.test.ts`) est du code Node et `pnpm test` est sur la liste blanche —
> écriture autorisée + commande autorisée = privilèges complets. Mesuré et
> documenté en T-J0-04. Ne présente jamais ce cloisonnement comme étanche.

**Quand tu l'invoques** : étape 6 du workflow ci-dessus, sur les tâches `[T]`
seulement, une fois le code et les tests initiaux livrés. Les bugs qu'il
rapporte, **c'est toi qui les corriges** — il n'a pas le droit d'y toucher.

### Règle du test rouge

C'est le cœur du dispositif. Le réflexe le plus destructeur face à une suite
rouge est de rendre le test vert.

| Situation | Action autorisée |
|---|---|
| Test rouge, code conforme à la SPEC | ❌ Ne pas toucher au test. Signaler l'écart |
| Test rouge, code bugué | ❌ Ne pas toucher au test. Rapporter le bug |
| Test rouge, **test lui-même fautif** (assertion fausse, oracle incorrect, dépendance à un détail d'implémentation invalidé par un refactor légitime) | ✅ Modification autorisée, **avec justification écrite** dans la PR |
| Test manquant identifié (cas limite, adversarial) | ✅ Ajout autorisé |

Un test qui échoue est **présumé avoir raison**. L'exception exige une trace
auditable.

Quand une tâche porte le marqueur `[T]`, le test doit avoir **échoué au moins
une fois** avant de passer, et ce rouge est visible dans l'historique des
commits.

## Workflow d'une tâche

1. Lire la tâche complète dans `spec-kit/04-tasks-hch/` **et ses sources**
   (chaque tâche les cite) avant d'écrire une ligne.
2. **Présenter un plan d'implémentation détaillé et attendre le GO.**
   Avant la première ligne de code : ce que tu vas écrire fichier par
   fichier, les paquets que tu installes, les commandes que tu lances,
   et surtout **la liste des points que les sources ne tranchent pas**.
   Un trou dans l'amont (une valeur absente d'un ADR, une consigne
   inapplicable, deux artefacts qui se contredisent) **se remonte, il ne
   se comble pas**. Tu proposes une lecture, Benjamin tranche, puis tu
   écris. Aucun code avant son GO explicite.
3. Branche courte : `feat/T-J0-01-bootstrap-repo`.
4. **1 commit = 1 tâche**, message `feat(T-J0-01): squelette Next.js + outillage`.
5. Commits `Co-Authored-By` — assumé et visible, jamais masqué
   ([[adr-013-cadre-ia|ADR-013]] §D5).
6. **Tâche marquée `[T]` : passer la main à l'agent `testeur` avant d'ouvrir
   la PR.** Une fois le code **et** les tests initiaux écrits — pas avant, il
   vérifie, il ne spécifie pas. Tu l'invoques par le sous-agent `testeur`,
   tu lui donnes la tâche et son périmètre, et tu **n'écris rien pendant
   qu'il travaille**. Son rapport (bugs, tests ajoutés, écarts SPEC, usages
   de la règle du test rouge) va dans le champ *Divergences* de la PR. Les
   bugs qu'il trouve, c'est **toi** qui les corriges — il n'y touche pas,
   c'est tout l'intérêt. Une tâche `[B]` sans tests ne l'invoque pas.
7. PR à trois champs → revue assistée → **revue humaine de Benjamin,
   non délégable** → squash sur `main`.
8. Le merge sur `main` déclenche le pipeline. Trunk-based : pas de branche
   `develop`, `release` ni `hotfix`.
9. Toute décision technique prise pendant le code → **writeback vers le vault**
   dans la même session, pas seulement dans le code.

La DoD d'une tâche est **exécutable** : un test qui passe, une commande qui
aboutit, une URL qui répond. Si tu ne peux pas vérifier une case sans lire le
code, la case est mal écrite — remonte-le.

## Stack

| Couche | Techno | Source |
|---|---|---|
| Application | Next.js 16.0.4+ App Router, un seul processus | [[adr-002-stack-back-hch\|ADR-002 v2]] |
| Rendu | RSC par défaut, `"use client"` explicite | [[adr-002-stack-back-hch\|ADR-002 v2]] |
| Mutations | Server Actions via `next-safe-action` | [[adr-006-archi-applicative-hch\|ADR-006 v2]] |
| Endpoints HTTP | Route Handlers — upload photos, callback OAuth | [[adr-002-stack-back-hch\|ADR-002 v2]] |
| Base | PostgreSQL + PostGIS | [[adr-004-postgres-postgis\|ADR-004]] |
| ORM | Prisma — `Unsupported("geography")` + `$queryRaw` | [[adr-008-orm-prisma\|ADR-008]] |
| Auth | Roll-your-own : bcrypt + `jose` + Google OAuth (PKCE) | [[adr-005-auth-hch\|ADR-005 v2]] |
| UI | Tailwind v4 + shadcn/ui + `cva` + Radix + Lucide | [[adr-012-maquettage-stitch-shadcn\|ADR-012]] |
| Carto | Google Maps + Geocoding + Drawing Library | [[adr-015-provider-carto\|ADR-015]] |
| Server state client | TanStack Query, **3 vues seulement** | [[s1-archi-stack\|S1]] §6.1 |
| Tests | Vitest + RTL + Playwright + MSW, Testing Trophy | [[adr-014-testing-hch\|ADR-014]] |
| Runtime | Node 24 LTS, pnpm 10+ | [[s3-infra-ci-cd\|S3]] (amendé 2026-08-05 : 22 → 24, EOL 22 le 30/04/2027) |
| Déploiement | Docker, VPS OVH `glanford.eu`, GitHub Actions | [[adr-010-ci-cd\|ADR-010]] |

**MongoDB n'existe pas en v1.** [[adr-011-nosql|ADR-011]] pose son
implémentation en avril 2027.

### Ce que le vault écrit encore et qui est faux

Six points où l'amont est stale. **Suivre la colonne de droite**, et si tu
touches à ces sujets, le signaler pour writeback.

| Le vault écrit | Appliquer |
|---|---|
| Tailwind + **DaisyUI** ([[s1-archi-stack\|S1]] §2, §5.1 · [[adr-006-archi-applicative-hch\|ADR-006 v2]]) | **shadcn/ui**, pas de DaisyUI — [[adr-012-maquettage-stitch-shadcn\|ADR-012]] §D1 |
| `tailwind.config.ts` ([[adr-006-archi-applicative-hch\|ADR-006 v2]]) | **Aucun fichier config** — `@theme` dans `globals.css` |
| « Next.js 15+ » | **Next 16.0.4+** (CVE-2026-27978) |
| `src/middleware.ts` ([[adr-005-auth-hch\|ADR-005 v2]] · [[s1-archi-stack\|S1]] §7.1) | **`src/proxy.ts`** (renommage Next 16) |
| Dépôt **public** ([[s1-archi-stack\|S1]] §5.1) | **Privé** jusqu'au sprint S3 — amendement [[adr-010-ci-cd\|ADR-010]] du 2026-08-03 |
| Base de dev montée par un **compose local** | **Base distante** sur le VPS, tunnel SSH `localhost:5433` — [[setup-poste-hch]], en service depuis le 2026-08-04. Le seul compose local est celui des **tests** |

## Conventions React/Next — HCH

Format impératif, sans justification : les pourquoi vivent dans les ADR HCH et
dans les 12 pages d'axe de [[conventions-react-next]].

### Architecture App Router

- **MUST** tout RSC par défaut. `"use client"` seulement pour state, effets,
  browser API, ou hook stateful.
- **MUST** descendre la frontière `"use client"` au composant feuille
  interactif, jamais un layout.
- **MUST** pattern donut : un Client Component accepte `children` et reçoit des
  Server Components depuis l'extérieur.
- **MUST** `import 'server-only'` en tête de tout module `src/lib/` qui touche
  DB, env ou secrets.
- **MUST** si `cacheComponents: true` est activé : poser `"use cache"` **ou**
  wrapper en `<Suspense>` tout RSC qui fetch ou accède à une runtime source
  (`params`, `cookies`, `headers`, `searchParams`). Sans ça, Next 16 rejette le
  rendu avec une erreur « Blocking Route ». Leçon Argo payée trois fois
  (PR #6, #8, #120).
- **MUST** `"use cache"` interdit sur un read qui dépend d'une variable d'env
  runtime absente au build (DB, secrets) — même si la surface est « stable ».
  Fallback : shell async sous `<Suspense>`. Leçon Argo PR #120.
- **MUST NOT** double tree (`<html>`/`<body>` rendus par un Client Component).
- **MUST NOT** `'use client'` sur `src/app/layout.tsx`.
- **DEFAULT** file conventions standard : `page.tsx`, `layout.tsx`,
  `loading.tsx`, `error.tsx`, `not-found.tsx`, `route.ts`. Pas de `template.tsx`.
- **DEFAULT** route groups `(marketing)`, `(auth)`, `(app)` pour partager un
  layout sans préfixer l'URL.
- **DEFAULT** invalidation par `updateTag()` pour les mutations utilisateur
  (read-your-writes Next 16), `revalidatePath()` / `revalidateTag()` ailleurs.

### Server Actions + Forms

- **MUST** Server Actions pour **toutes** les mutations. Route Handlers réservés
  à trois cas : `api/auth/google/{initiate,callback}`,
  `api/upload-intervention-photo`, et les webhooks éventuels.
- **MUST** wrapper chaque action avec input dans `next-safe-action`
  (`createSafeActionClient` + `.use().inputSchema().action()`), schémas Zod dans
  `src/lib/validations/<domaine>.ts`.
- **MUST** authentifier via `src/lib/auth/dal.ts` **au début de chaque action**.
  Rappel [[adr-006-archi-applicative-hch|ADR-006 v2]] : *chaque Server Action
  exportée est un endpoint POST public.* La page protège ≠ l'action protège.
- **MUST** séparer le **helper métier** (`src/lib/db/queries/<domaine>.ts`,
  testable sans contexte Next) de la **Server Action** (`src/lib/actions/<domaine>/`,
  qui orchestre `next-safe-action` + `revalidatePath` + `redirect`).
  `revalidatePath` et `redirect` jettent hors contexte Next — leçon Argo PR #10.
- **MUST** écrire l'audit RGPD via `src/lib/audit/log.ts` dans toute action qui
  mute une entité sensible (Constitution §4.2).
- **MUST** `redirect()` **hors** `try/catch` (il fonctionne par throw).
- **MUST NOT** `revalidatePath` / `updateTag` / `redirect` dans le helper métier.
- **MUST NOT** appeler une Server Action depuis un Server Component.
- **MUST NOT** stocker un secret ou un ID privilégié dans `bind` (non chiffré).
- **DEFAULT** `<form action={action}>` direct si ≤ 3 champs.
- **DEFAULT** `useActionState` dès qu'il faut afficher des erreurs Zod.
- **DEFAULT** `useFormStatus()` dans un `<SubmitButton>` séparé.
- **DEFAULT** react-hook-form + Zod pour les formulaires complexes — tunnel de
  réservation, création de zone, fiche client.

### Data fetching

- **MUST** Read = `await` Prisma directement dans les Server Components.
  Write = Server Actions.
- **MUST** wrapper les fonctions DAL-like (`verifySession`, `getCurrentUser`,
  lectures partagées intra-render) dans `cache()` de React.
- **MUST** fetch indépendants en parallèle (siblings RSC ou `Promise.all`),
  jamais en cascade implicite.
- **MUST NOT** TanStack Query hors des **trois vues** autorisées : planning
  technicien du jour, planning admin, grille de créneaux pendant une
  réservation. Partout ailleurs, revalidation Next en sortie d'action.
- **MUST NOT** Route Handler appelé depuis un Client Component pour de la
  lecture.
- **MUST NOT** `useEffect` + `setState` pour un fetch initial.
- **DEFAULT** paramétrage du polling conforme à [[s1-archi-stack|S1]] §6.1 :
  `refetchInterval: 30_000` et `refetchIntervalInBackground: false`. L'intervalle
  de 30 s est un choix d'éco-conception, pas un oubli.
- **DEFAULT** intégration App Router : `getQueryClient()` factory avec garde
  `isServer` (jamais un singleton module-level) + `prefetchQuery` serveur +
  `<HydrationBoundary>`.

### Folder structure

- **MUST** `src/` à la racine, tout le code applicatif dedans. Configs
  (`next.config.ts`, `tsconfig.json`, `package.json`, `.env*`,
  `eslint.config.mjs`, `.prettierrc`, `.prettierignore`, `.dockerignore`,
  `prisma.config.ts`, `pnpm-workspace.yaml`,
  `vitest.config.mts`, `playwright.config.ts`, `components.json`) à la racine.
  `src/proxy.ts` dans `src/`. `public/` et `prisma/` à la racine.
- **MUST** `prisma.config.ts` comme **source unique** de configuration du CLI
  Prisma. Depuis la 6.19, `prisma init` le scaffolde et le CLI l'utilise dès
  qu'il existe (`Prisma config detected, skipping environment variable
  loading`) : la clé `package.json#prisma` est **ignorée**, le seed vit dans
  `migrations.seed`. C'est aussi ce fichier qui charge `.env.local`, que le CLI
  ne lit pas nativement — donc **pas de `dotenv-cli`**. Deux pièges dedans :
  le helper `env()` de `prisma/config` lève **au chargement du fichier**, donc
  pour `prisma generate` aussi (le stage builder du Dockerfile n'a pas de
  `DATABASE_URL`) — utiliser `process.env[…] ?? ""` ; et le bloc `datasource`
  est **obligatoire** sous `engine: "classic"`.
- **MUST** `src/lib/env.ts` — schéma Zod des variables d'environnement
  attendues, **validé au runtime serveur**, jamais à l'import évalué au build.
  Une variable manquante empêche le conteneur de servir : healthcheck rouge,
  rollback inline vers l'image précédente, job rouge. Sans cette garde, l'absence
  d'une clé applicative ne se voit qu'à l'usage — la clé de géocodage au tunnel
  de réservation, le mot de passe d'application email à l'inscription.
- **MUST NOT** évaluer ce schéma au chargement d'un module importé par le build.
  C'est exactement le piège payé sur `prisma.config.ts` ci-dessus : le stage
  builder du Dockerfile n'a **aucune** de ces variables.
- **MUST** toute variable nouvelle est posée dans le `.env.prod` des **deux**
  piles, dans `.env.prod.example`, et dans l'Environment GitHub si le pipeline la
  consomme — plus son entrée dans `src/lib/env.ts`. La consigne seule ne suffit
  pas, la garde seule non plus.
- **MUST** déclarer dans `onlyBuiltDependencies` (`pnpm-workspace.yaml`) tout
  paquet qui a besoin d'un script d'installation. pnpm 10 n'en exécute aucun
  sans autorisation, et **échoue en silence** : `bcrypt` se retrouve sans
  binaire, `tsx` ne démarre pas. `pnpm approve-builds` est interactif, donc
  inutilisable en CI — la liste est la seule voie. Aujourd'hui :
  `@prisma/client`, `prisma`, `bcrypt`, `esbuild`.
- **MUST** lancer `pnpm exec prisma generate` **après tout clone neuf**. La
  liste ci-dessus ne suffit pas : constaté le 2026-08-06 sur un poste vierge,
  `pnpm install` affiche `Ignored build scripts: @prisma/engines` et le client
  n'est **pas** généré, alors que `@prisma/client` y figure. Le premier
  `prisma db seed` échoue sur `did not initialize yet`. Faux positif à
  connaître : `pnpm exec prisma -v` répond — il prouve le **CLI**, pas le
  **client**, ce sont deux artefacts distincts.
- **MUST** `.dockerignore` à jour dès qu'un dossier apparaît à la racine. Le
  `COPY . .` du stage builder copie le **répertoire de travail**, pas l'index
  Git : `.gitignore` n'y protège de rien. Sans lui, les `node_modules` de
  l'hôte Windows écrasent ceux qu'Alpine a compilés, et `next build` lit le
  `.env.local` du poste au lieu de la configuration de la pile visée.
- **MUST** deux modèles d'environnement commités et vides de valeurs :
  `.env.example` (le `.env.local` de chaque poste) et `.env.prod.example`
  (le `.env.prod` de chaque pile VPS). Tous deux exigent une exception
  explicite dans `.gitignore`, que la règle `.env*` avalerait sinon.
- **MUST** `src/app/` ne contient que le routing + les private folders
  `_components/` co-localisés.
- **MUST** unidirectionnalité : `src/lib/` n'importe **jamais** depuis
  `src/components/` ni `src/app/`. Vérif : `grep -r "from '@/components" src/lib/`
  doit retourner zéro.
- **MUST** kebab-case fichiers et dossiers, PascalCase exports React, camelCase
  fonctions et variables. Fichiers spéciaux Next : casing imposé.
- **MUST** un domaine, **un nom, partout** — le même dans `lib/actions/<d>/`,
  `lib/db/queries/<d>.ts`, `lib/validations/<d>.ts`,
  `components/features/<d>/`.
- **MUST NOT** barrel `index.ts` qui ré-exporte tout un dossier.
- **MUST NOT** `hooks/` ou `stores/` rangés dans `lib/` — la frontière
  server/client doit rester lisible dans le filesystem.
- **MUST NOT** dossier `clients/` ou `techniciens/` : ce sont des `users`
  porteurs d'un rôle, pas des domaines. La distinction vit dans les routes et
  dans `lib/auth/permissions.ts`.
- **DEFAULT** les **10 domaines** HCH ([[s1-archi-stack|S1]] §4) : `auth`,
  `users`, `adresses`, `cycles`, `interventions`, `zones`, `forfaits`,
  `produits`, `paiements`, `parametres`.
- **DEFAULT** `src/components/` en trois : `ui/` (primitives shadcn, aucune
  connaissance du domaine), `features/<domaine>/`, `layouts/`.
- **DEFAULT** règle des 2 usages : un composant naît dans
  `app/<route>/_components/` et monte dans `components/features/<domaine>/` au
  **2ᵉ** usage, pas avant.
- **DEFAULT** routes en **français** (`/client/reserver`, `/tech/planning`,
  `/admin/zones`), noms de fichiers composants en **anglais**
  (`reservation-form.tsx`, `intervention-card.tsx`).

Arborescence de référence : [[adr-006-archi-applicative-hch|ADR-006 v2]]
§Structure cible, peuplée par [[s1-archi-stack|S1]] §3.

### Authentication

- **MUST** `src/lib/auth/dal.ts` avec `verifySession = cache(...)` et
  `getCurrentUser = cache(...)`. Tout RSC, Server Action et Route Handler passe
  par là.
- **MUST** mot de passe hashé bcrypt, cost ≥ 10 (`src/lib/auth/password.ts`).
- **MUST** session JWT signée `jose` (`src/lib/auth/session.ts`), cookie
  `httpOnly: true`, `secure: true`, `sameSite: 'lax'`, `path: '/'`, 7 jours.
- **MUST** `src/proxy.ts` en **redirect optimiste seulement**, sur présence du
  cookie. Jamais l'unique rempart, jamais de lecture DB dedans — leçon
  structurelle CVE-2025-29927, conservée même après patch.
- **MUST** vérification réelle du rôle dans chaque Server Action et chaque
  lecture sensible, via `src/lib/auth/permissions.ts`.
- **MUST** réponse **identique** que l'email existe ou non, sur login comme sur
  mot de passe oublié (anti-énumération, Constitution §4.2, SPEC §6.1).
- **MUST** OAuth Google en Authorization Code + PKCE, avec vérification du
  `state` (`src/lib/auth/oauth-google.ts`).
- **MUST NOT** Better Auth, Auth.js, Clerk ou Lucia. Le roll-your-own est un
  choix pédagogique assumé — [[adr-005-auth-hch|ADR-005 v2]] fait foi contre le
  défaut de [[05-authentication|l'axe 05]].
- **MUST NOT** session en `localStorage`.
- **MUST NOT** check d'autorisation dans un layout partagé (le Partial Rendering
  ne le rejoue pas en navigation client — le check devient obsolète).
- **MUST NOT** renvoyer un objet `User` complet au client — DTO.
- **DEFAULT** rôles en `users.roles: VARCHAR[]`, valeurs `ROLE_CLIENT`,
  `ROLE_TECH`, `ROLE_ADMIN`.

### State management

- **MUST** `reactCompiler: true` dans `next.config.ts` dès le bootstrap.
- **MUST** mettre dans l'URL (via `nuqs`) tout ce qui doit être partageable :
  filtres du planning, date affichée, pagination, onglet actif.
- **MUST NOT** `useMemo` / `useCallback` / `React.memo` à la main en code neuf,
  sauf escape hatch commenté `// PERF: ...`.
- **MUST NOT** stocker session, profil ou données métier dans Zustand.
- **MUST NOT** `Context` pour de l'état changeant — réservé aux valeurs stables.
- **DEFAULT** un outil par catégorie : server state → RSC fetch (+ TanStack
  Query sur les 3 vues) · global client → Zustand · URL → `nuqs` · formulaire →
  react-hook-form + Zod · local → `useState` · dérivé → calcul en clair.
- **DEFAULT** `useOptimistic` pour les mutations à feedback immédiat
  (annulation de créneau, marquage d'intervention faite).

### TypeScript

- **MUST** strict mode. `tsconfig.json` minimum : `strict: true`,
  `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`,
  `noFallthroughCasesInSwitch: true`. TS 5.9+.
- **MUST** **zéro `any`**. `unknown` partout où la donnée n'est pas typée, puis
  narrow via Zod ou type guard.
- **MUST** `z.infer<typeof schema>` comme source unique de vérité. Jamais de
  duplication interface / schema.
- **MUST** `params` et `searchParams` typés `Promise<{ ... }>` et awaités.
- **MUST** discriminated unions pour tout résultat multi-branche — statut
  d'intervention, résultat de géocodage (`{ ok: true; point }` |
  `{ ok: false; reason }`), résultat d'appartenance à une zone. Exhaustivité
  forcée par `never`.
- **MUST** named exports. Pas de `default export`, sauf imposé par Next
  (`page.tsx`, `layout.tsx`, `route.ts`…).
- **DEFAULT** Zod 4.
- **DEFAULT** branded types pour les IDs critiques : `UserId`, `InterventionId`,
  `ZoneId`.
- **DEFAULT** `satisfies` plutôt qu'annotation, pour préserver l'inférence.

### Commentaires

- **MUST** le code porte le **quoi** et le **pourquoi immédiat**, en 1 à 3
  lignes. Le raisonnement arbitré, les alternatives écartées et les
  conséquences futures vivent dans le vault, et le code y **pointe**
  (`// cf. ADR-014 §3`).
- **MUST** commenter ce qui n'est pas déductible du code : une règle métier,
  un piège de bibliothèque, un ordre d'exécution qui compte, un choix
  contre-intuitif. Jamais ce que le code dit déjà.
- **MUST NOT** déposer dans le code une délibération : constat d'agent
  testeur, analyse de risque résiduel, DoD d'une tâche future,
  recommandation d'évolution. Ça appartient à `points-ouverts-hch` ou à
  `TASKS` — et écrit dans un fichier source, **personne ne le relira au
  moment où il compte**.
- **MUST NOT** laisser un commentaire que le code a rendu faux. Un
  commentaire qui affirme une vulnérabilité corrigée est pire que pas de
  commentaire du tout.
- **Signal de dérive** : un fichier dont plus de ~30 % des lignes sont du
  commentaire porte probablement un ADR déguisé.

### Patterns composants

- **MUST** composition (`children` + slots) en première intention.
- **MUST** custom hook pour toute logique stateful réutilisable — préfixe `use`,
  un hook par fichier dans `src/hooks/`, retour d'objet à partir de 3 valeurs.
- **MUST** ref passée comme prop normale (React 19). Pas de `forwardRef` neuf.
- **MUST NOT** HOC en code neuf — refactor en custom hook.
- **MUST NOT** render props pour du state simple.
- **MUST NOT** réinventer un composant accessible que Radix fournit déjà.
- **DEFAULT** compound components avec Context interne pour l'UI multi-pièces,
  avec garde `useXContext()` qui throw hors provider.
- **DEFAULT** `Slot` + `asChild` (pattern Radix fourni par shadcn).
- **DEFAULT** composants métier custom construits **directement sur Radix**
  hors catalogue shadcn : calendrier du planning technicien, dessin de polygone
  de zone ([[adr-012-maquettage-stitch-shadcn|ADR-012]] §D1).

### Performance

- **MUST** `<Image>` de `next/image` partout, sauf SVG inline et favicons.
  `priority` sur la seule image LCP au-dessus du fold.
- **MUST** width/height (ou `fill` + `sizes`) sur toute image — pas de CLS.
- **MUST** `next/font/google` avec self-hosting pour Plus Jakarta Sans (titres)
  et Manrope (corps), `subsets: ['latin']`, dans `src/app/layout.tsx`. Pas de
  `<link>` Google Fonts manuel — la dépendance DNS est explicitement écartée
  par [[adr-012-maquettage-stitch-shadcn|ADR-012]] §D4.
- **MUST NOT** désactiver le prefetch `<Link>` globalement.
- **MUST NOT** virtualiser sous 200 items DOM.
- **DEFAULT** `next/dynamic` + `<Suspense>` pour le client lourd hors du fold —
  carte Google Maps, calendrier, modales.
- **DEFAULT** `experimental.optimizePackageImports` pour `lucide-react` et `zod`.
  L'option vit sous **`experimental`**, et `lucide-react` figure **déjà dans la
  liste optimisée par défaut** de Next 16 — il y est listé pour l'intention,
  `zod` est le seul des deux à rendre l'option utile.
- **DEFAULT** Node runtime. Pas d'Edge (Prisma + PostGIS l'excluent).

### Styling / UI

- **MUST** Tailwind v4 : `@import "tailwindcss"` dans `src/app/globals.css` +
  design tokens en directive `@theme` dans le même fichier.
- **MUST** palette [[adr-012-maquettage-stitch-shadcn|ADR-012]] §D4 « Kinetic
  Urbanist » verte — `primary #005344`, `primary-fixed #9df3dc`,
  `tertiary-fixed #ffe16d` (CTA urgents), `background #f8faf8`,
  `foreground #191c1b`, `destructive #ba1a1a`. Traduits en vocabulaire shadcn,
  **jamais en tokens Material 3**.
- **MUST** `cn()` helper (`clsx` + `tailwind-merge`) dans `src/lib/utils.ts`.
- **MUST NOT** créer `tailwind.config.js` / `tailwind.config.ts` — Tailwind v4
  est CSS-first. Ce que [[adr-006-archi-applicative-hch|ADR-006 v2]] écrit sur
  ce point est stale.
- **MUST NOT** **DaisyUI** ([[adr-012-maquettage-stitch-shadcn|ADR-012]] §D1 et
  §Alt-A). Ce que [[s1-archi-stack|S1]] §2 et §5.1 écrivent est stale.
- **MUST NOT** CSS-in-JS runtime (styled-components, Emotion) — incompatible RSC.
- **MUST NOT** porter le `code.html` de Stitch brut. Les maquettes sont une
  **référence visuelle**, le code est refait main
  ([[adr-012-maquettage-stitch-shadcn|ADR-012]] §D6) — c'est un engagement
  défendu devant le jury, pas une préférence.
- **MUST NOT** icônes Material Symbols — **Lucide** partout.
- **DEFAULT** shadcn/ui via `pnpm dlx shadcn@latest add <composant>`, installé
  dans `src/components/ui/`. Catalogue attendu : `Button`, `Card`, `Dialog`,
  `Sheet`, `Form`, `Input`, `Select`, `Combobox`, `Calendar`, `Tabs`, `Table`,
  `Badge`, `Avatar`, `DropdownMenu`, `Sonner`, `Skeleton`.
- **DEFAULT** `cva` pour les variants typés. `tailwind-variants` seulement si
  slots.
- **DEFAULT** angles : `rounded-xl` boutons, `rounded-2xl` cards, `rounded-3xl`
  grands containers. Les **inputs n'ont pas d'angle imposé** — suivre la
  maquette de l'écran.
- **DEFAULT** ces valeurs sont des défauts, pas un gabarit. Quand une maquette
  validée diverge, **la maquette fait foi**, sans amendement d'ADR à chaque
  écran ([[adr-012-maquettage-stitch-shadcn|ADR-012]] §D4).
- **DEFAULT** avant de coder un écran, lire [[maquettage]] §Notes portage : les
  divergences maquette ↔ SPEC y sont compilées écran par écran (vocabulaire
  « mécanicien » à corriger en « technicien », mentions SMS et Recrutement hors
  scope v1, durées de créneaux inventées, etc.).
- **DEFAULT** responsive à ajouter au portage — les maquettes sont en desktop
  1920×1080 uniquement. Mobile-first sur le parcours technicien, responsive
  complet côté client.

### Accessibilité

- **MUST** RGAA niveau **A** sur toute l'application v1, niveau **AA** sur le
  parcours de connexion ([[s4-nf-transverses|PLAN S4]] §2).
- **MUST** hiérarchie de titres cohérente, labels explicites, focus visible,
  navigation clavier complète, contrastes conformes.
- **MUST** `jest-axe` sur les composants critiques et `@axe-core/playwright` sur
  les golden paths — la conformité est **prouvée par un test**, pas déclarée.
- **DEFAULT** la RGAA coûte peu pendant l'écriture et très cher en rattrapage :
  la poser au fil, jamais en fin de phase.

### Tooling

- **MUST** pnpm 10+, champ `packageManager` dans `package.json`.
- **MUST** ESLint pour le **lint** — `eslint.config.mjs` flat config avec
  `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`. Les 21
  règles `@next/next/*` couvrent des pièges App Router qu'aucun autre linter
  n'attrape.
- **MUST** Prettier pour le **format**, avec `prettier-plugin-tailwindcss`
  pour le tri des classes. Biome a été essayé au scaffold et écarté : son
  tri est une règle de lint *nursery* qui ne trie pas les variants d'écran
  et ignore les utilitaires `@theme` custom — inutilisable sur une palette
  entièrement en tokens.
- **MUST** `tailwindStylesheet` pointé sur `src/app/globals.css` dans
  `.prettierrc`. En Tailwind v4 CSS-first il n'y a pas de config à lire :
  sans cette option le plugin ignore nos utilitaires custom.
- **MUST** `--frozen-lockfile` en CI.
- **MUST NOT** `next lint` — retiré en Next 16. ESLint CLI directement.
- **MUST NOT** `.eslintrc.*` legacy — ESLint 10 ne supporte que la flat config.
- **MUST NOT** `tsc --noEmit` en `lint-staged` : il doit voir tout le projet,
  donc en pre-push.
- **DEFAULT** Turbopack (intégré Next 16, zero-config).
- **DEFAULT** `lint-staged` + `lefthook`.
- **DEFAULT** `tsx` pour les scripts TS locaux (dont `prisma/seed.ts`).
- **DEFAULT** pas de Turborepo — une seule app, [[04-folder-structure]] §13.G
  règle 9.

### Base de données et migrations

- **MUST** [[mcd-dictionnaire]] v2.2 (18 tables) fait foi sur le modèle. Toute
  divergence entre `schema.prisma` et le dictionnaire est **remontée avant
  d'écrire la migration**.
- **MUST** PostGIS accédé par `$queryRaw` typé depuis `src/lib/geo/postgis.ts` —
  Prisma ne représente pas `geography`, la colonne est en
  `Unsupported("geography")`.
- **MUST** les quatre contraintes d'intégrité de [[s2-mcd-data|PLAN S2]] §5 sont
  en **double filet** : garde applicatif dans la Server Action **et** contrainte
  ou trigger PostgreSQL. `EXCLUDE USING gist` anti-double-réservation, trigger
  dernier admin, `technician_zones` porteur de `ROLE_TECH`, verrou de stock.
- **MUST** `prisma migrate deploy` en CI et en production. `migrate dev`
  uniquement en local.
- **MUST NOT** table `availabilities` — les créneaux disponibles se **calculent
  à la volée** (Constitution §2.1). Aucun créneau ne préexiste au forfait.
- **MUST NOT** supprimer physiquement un utilisateur porteur d'interventions :
  `is_active = false` (soft-delete admin) ou pseudonymisation in-place
  (droit à l'oubli), jamais une FK cassée (Constitution §4.1).
- **MUST NOT** créer un `docker-compose.dev.yml`. La base de développement est
  **distante et déjà en service** — `hch-postgres-dev` sur le VPS depuis le
  2026-08-04. Il n'y en a pas, il ne doit pas y en avoir : on s'y raccorde par
  le tunnel (§Deux postes de développement), on ne la remonte pas en local. Le
  seul compose local est celui des tests, éphémère.

### Docker et déploiement

Les quatre pièges ci-dessous ont été payés en production sur Argo (PR #121-#124).
**HCH démarre corrigé.**

- **MUST** healthcheck en `127.0.0.1` **explicite**, jamais `localhost` : sous
  Alpine, `localhost` résout en IPv6 alors que Next écoute en IPv4, et le `wget`
  de BusyBox ne bascule pas. À appliquer aux **deux** endroits — healthcheck du
  compose **et** boucle de vérification post-deploy du workflow.
- **MUST NOT** `outputFileTracingIncludes` pour Prisma dans `next.config.ts`.
  L'inverse était prescrit ici jusqu'au 2026-08-05 (fix Argo T-T11-02, établi
  sur Next 16.0.x + Prisma 6.1). Sur **Next 16.3 + Prisma 6.19.2 + pnpm 10**
  les globs font échouer le traçage sur un lien symbolique du store pnpm
  (`@prisma+engines/…/@prisma/debug`, lu comme un fichier) : `pnpm build` et
  `docker build` cassent tous les deux. Sans eux, le client est embarqué de
  lui-même. Le filet perdu est réel — un moteur absent ne se voit plus qu'au
  503 de `/api/health`, donc après déploiement.
- **MUST** engines CLI Prisma pré-téléchargés au build, sans `--ignore-scripts`,
  parce que le runtime tourne en `USER nextjs` non-root et ne peut plus écrire.
- **MUST** `set -euo pipefail` en tête de chaque script SSH du pipeline — sans
  lui, un `migrate deploy` en échec continue en silence et le healthcheck
  vérifie une application jamais montée.
- **MUST** `docker-compose.prod.yml` **sans aucune directive `build:`** —
  uniquement `image: benstau/hch:${IMAGE_TAG}`. Ce qui est validé en staging est
  littéralement ce qui part en production.
- **MUST** réseaux Docker isolés entre staging et production, seul `proxy` est
  partagé.
- **MUST NOT** `docker build` local comme unique vérification d'un Dockerfile de
  production — déléguer au job `build-push`.
- **DEFAULT** `output: 'standalone'`, multi-stage `deps` → `builder` → `runner`,
  base `node:24-alpine`, `USER nextjs` (UID 1001).

Détail applicatif complet : [[s3-infra-ci-cd|PLAN S3]].

### Testing

- **MUST** Vitest comme runner unique. Jest interdit.
- **MUST** React Testing Library — *test behavior, not implementation*.
  Hiérarchie de queries : Role > LabelText > PlaceholderText > Text >
  DisplayValue > AltText > Title > TestId.
- **MUST** `@testing-library/user-event` v14+. Pas de `fireEvent`.
- **MUST** MSW 2 pour mocker à la frontière réseau — endpoint token Google
  OAuth, Geocoding API. `onUnhandledRequest: 'error'`, handlers partagés entre
  Vitest et Playwright dans `src/mocks/`.
- **MUST** Playwright pour l'E2E, `webServer` = `pnpm dev` en local,
  `pnpm build && pnpm start` **en CI** — la CI teste la vraie pipeline de
  production, jamais le dev server.
- **MUST** async Server Components → **E2E uniquement**. Vitest et RTL ne
  savent pas les dérouler.
- **MUST** tests co-localisés : `*.test.ts` à côté du module. E2E Playwright
  dans `tests/`.
- **MUST** un seul `<module>.test.ts` par module. Deux suffixes seulement sont
  autorisés à ouvrir un fichier de plus, et ils décrivent une **intention de
  test**, pas un découpage de confort :
  - `<module>.adversarial.test.ts` — tentatives d'attaque et cas hostiles ;
  - `<module>.timing.test.ts` — mesures de temps constant.
  Tout autre suffixe (`.cache`, `.revocation`, `.next`…) est un `describe`
  imbriqué dans le fichier du module, pas un fichier.
- **MUST NOT** `vi.mock(fetch)` — MSW à la place.
- **MUST NOT** `getByTestId` par défaut (query de dernier recours).
- **MUST NOT** viser 100 % de couverture. Cible indicative ~70 % lignes,
  ~60 % branches.
- **DEFAULT** Testing Trophy : ~10 % unitaire, ~70 % intégration, ~20 % E2E.
- **DEFAULT** les **5 golden paths** E2E d'[[adr-014-testing-hch|ADR-014]] §5 :
  `GP-01 signup-login-client`, `GP-02 reserver-intervention`,
  `GP-03 annuler-creneau`, `GP-04 admin-creation-zone`,
  `GP-05 login-google-oauth`.
- **DEFAULT** `storageState` Playwright pour pré-loger client, technicien et
  admin, au lieu de rejouer le login dans chaque test.
- **DEFAULT** les queries PostGIS ne se mockent pas — `docker-compose.test.yml`
  monte un vrai Postgres + PostGIS, seedé au `globalSetup`.

## Règles métier qui mordent sur le code

Elles viennent de [[01-constitution-hch|la Constitution]] et priment sur toute
décision de design. Les violer produit du code qui compile et un produit faux.

- **Le technicien se déplace, jamais le client** (§1.1) — pas d'entité `atelier`
  comme lieu d'intervention. Toute intervention est géolocalisée à une adresse
  client validée.
- **Marketplace transactionnelle** (§1.2) — le tunnel aboutit à une intervention
  planifiée **sans intervention humaine**. Pas de file de leads, pas de rappel.
- **Le forfait dicte le créneau** (§2.1) — le pool des créneaux se dérive à la
  volée : `planning(tech de la zone) × durée(forfait) − créneaux occupés`.
  Jamais stocké.
- **La géographie sectorise** (§2.2) — appartenance à une zone calculée
  géométriquement (point-in-polygon). Une adresse non géocodée **bloque** la
  réservation. Zones dessinées par l'admin, pas déduites d'un code postal.
- **Paiement terrain uniquement** (§2.3) — **aucune** intégration de paiement en
  ligne. La table `payments` porte un encaissement déclaratif du technicien.
  Si tu vois passer Stripe dans une proposition, c'est une erreur.
- **L'intervention est le pivot** (§2.4) — `PLANNED → IN_PROGRESS →
  DONE | CANCELLED`, transitions gardées, actions terminales **irréversibles
  côté serveur**. Statut en ENUM, jamais en texte libre. Pas de `CONFIRMED` en
  v1 (basculé v2 par l'amendement du 2026-07-06).
- **Preuve terrain horodatée** (§2.5) — photos et commentaires attachés à
  l'intervention, porteurs de leur auteur et de leur timestamp.
- **Service + vente = acte unique** (§2.6) — même panier, même paiement, même
  facture. Pas de boutique séparée.
- **Trois rôles cloisonnés** (§3.1) — le technicien ne peut **pas** modifier les
  prix : interdit fonctionnel, pas seulement masqué dans l'UI.
- **La réservation précède l'inscription** (§3.2) — `client_id` nullable au
  moment de la réservation guest, `guest_email` porte la clé de rattachement
  rétroactif.
- **Prix figé à la réservation** (§4.1) — `price_snapshot` /
  `unit_price_snapshot` sur chaque ligne. Un changement de tarif catalogue
  n'altère **jamais** une facture passée.
- **Gouvernance** (§4.2) — `audit_logs` alimenté par les suppressions,
  modifications tarifaires et anonymisations · le **dernier administrateur** ne
  peut être ni supprimé ni rétrogradé · `users.id` en **UUID v4** (pas
  d'énumération par incrément sur les URLs publiques).
- **Transparence tarifaire** (§5.1) — le catalogue des forfaits, prix et durées,
  est accessible **sans authentification**.

## Deux postes de développement

Benjamin code depuis deux machines : le **PC maison** (Docker fonctionne) et le
**PC Shadow**, une VM distante où **Docker ne peut pas tourner** (virtualisation
imbriquée indisponible). Tu peux être sur l'une ou sur l'autre, et tu n'as aucun
moyen de le deviner autrement qu'en regardant. Procédure complète :
[[setup-poste-hch]].

**La base de développement est unique, distante, et déjà en service** depuis le
2026-08-04 : `hch-postgres-dev` sur le VPS (`/opt/hch-dev/`,
`postgis/postgis:16-3.4`, PostGIS 3.4), publiée sur `127.0.0.1:5434` côté
serveur et jointe par un tunnel SSH. Les deux postes attaquent **la même base**.

### Savoir où tu es

```bash
docker info                                    # répond → daemon actif
test -d "/c/Program Files/Docker"              # existe → Docker installé
```

- **MUST** — poser cette question **avant** de proposer la moindre commande
  `docker`. Une commande Docker sur Shadow ne produit pas une erreur parlante,
  elle produit une session perdue à diagnostiquer un faux problème.
- **MUST** — **les deux commandes, dans cet ordre**, et les lire ensemble :
  `docker info` répond → **PC maison, daemon actif** · il échoue mais le
  répertoire existe → **PC maison, Docker Desktop simplement arrêté**, le
  démarrer · il échoue et le répertoire est absent → **Shadow**.
- **MUST NOT** — conclure « Shadow » sur le seul échec de `docker info`. Faux
  positif constaté le 2026-08-08 ([PR #15](https://github.com/BenSTAU/hch/pull/15)) :
  la commande ne distingue pas *daemon arrêté* de *poste sans daemon*, et
  appliquée à la lettre elle fait renoncer à Docker sur la machine qui l'a.
- **MUST NOT** — utiliser `docker compose version` comme test : il **répond sur
  Shadow** (CLI v5.1.3 installée) alors que le daemon est absent. Faux positif
  constaté le 2026-08-07. Seul `docker info` interroge le daemon.
- **DEFAULT** — `T-J0-02` (Dockerfile) et `T-J0-09` (`docker-compose.test.yml`)
  se traitent **au PC maison**, ce sont les deux seules tâches du jalon 0 qui
  exigent réellement Docker en local. Le piège `bcrypt` natif sur Alpine ne se
  révèle qu'au `docker build`.

### Le tunnel

```powershell
ssh -N -L 5433:127.0.0.1:5434 `
    -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes `
    glanfordDeploy
```

Fenêtre dédiée, ouverte pendant toute la session de travail — `-N` n'ouvre pas
de shell, l'absence d'affichage est le comportement normal. `glanfordDeploy` est
l'alias `~/.ssh/config` du compte `deployer` ; `glanford` pointe sur `adminssh`
et n'a rien à faire ici.

```bash
DATABASE_URL="postgresql://hch:<mot-de-passe>@localhost:5433/hch?connection_limit=5"
```

- **MUST** — cette ligne vit dans `.env.local`, gitignoré. C'est le **seul**
  fichier qui diffère entre les deux postes, et il n'a pas à être synchronisé.
- **MUST** — garder `connection_limit=5`. Chaque connexion Prisma est un canal
  multiplexé dans le tunnel : un pool large dégrade la latence au lieu de
  l'améliorer. Ne pas le retirer pour « voir si ça va plus vite ».
- **MUST** — devant une erreur de connexion à la base
  (`ECONNREFUSED 127.0.0.1:5433`, `P1001`, timeout Prisma), **soupçonner le
  tunnel avant le code**. Vérifier : `Test-NetConnection localhost -Port 5433`.
  Si c'est `False`, le tunnel est tombé — le relancer, ne rien modifier dans le
  projet. Une erreur de connexion n'est presque jamais un bug de configuration
  Prisma ici.

### Interdits propres à ce dispositif

- **MUST NOT** — ne jamais contourner l'absence de Docker en installant
  PostgreSQL nativement sur Shadow. Deux installations = deux versions de
  PostGIS susceptibles de diverger, sur un projet dont le cœur métier est
  `ST_Covers` et un index `EXCLUDE USING gist`. Le pire scénario n'est pas que
  ça casse, c'est que ça marche sur un poste et pas sur l'autre.
- **MUST NOT** — ne jamais publier un port Docker sans le préfixer
  `127.0.0.1:`. Docker contourne UFW : les ports publiés sont DNAT'és dans
  `PREROUTING` et ne traversent jamais `INPUT`, donc le pare-feu ne les voit
  pas. Un `ports: "5434:5432"` naïf exposerait la base à internet sans qu'aucun
  `ufw status` ne le signale.
- **MUST NOT** — ne jamais modifier le tag de l'image Postgres pour le seul
  environnement de développement. Les quatre environnements (dev, test, staging,
  production) partagent `postgis/postgis:16-3.4` **par construction** — c'est la
  raison d'être du dispositif. Une montée de version est une décision de PLAN,
  appliquée aux quatre à la fois.
- **DEFAULT** — état de base incohérent : ne pas le réparer à la main.
  `prisma migrate deploy` puis le seed. L'état de la base est un dérivé jetable,
  la source de vérité est le couple migrations + `seed.ts` dans Git.
- **DEFAULT** — `prisma migrate dev` peut proposer un reset sur cette base
  partagée : sans conséquence, Benjamin est seul dessus, il n'y a pas de travail
  concurrent à écraser. La commande de production reste `migrate deploy`.

**Ce qu'on accepte** : sans réseau, pas de développement — la base de dev est un
point de défaillance unique, c'est le prix de l'exigence « une seule base ». Le
repli documenté est Neon, à activer si la latence du tunnel dépasse 80 ms.

## Commandes

```bash
pnpm dev              # serveur de développement
pnpm build            # build de production
pnpm lint             # ESLint
pnpm format           # Prettier + tri des classes Tailwind
pnpm typecheck        # tsc --noEmit
pnpm test             # Vitest
pnpm test:e2e         # Playwright
pnpm prisma migrate dev      # migration locale
pnpm prisma migrate deploy   # migration CI / production
pnpm prisma db seed          # seed du référentiel
```

Prérequis de toute commande qui touche la base — le tunnel, dans une fenêtre
PowerShell dédiée (cf. §Deux postes de développement) :

```powershell
ssh -N -L 5433:127.0.0.1:5434 -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes glanfordDeploy
Test-NetConnection localhost -Port 5433     # contrôle, dans une AUTRE fenêtre
```

## Interdits absolus

- **Aucun secret dans le dépôt.** `.env.local` jamais commité, `.env.example`
  commité et vide de valeurs. Les secrets du pipeline vivent dans GitHub
  Secrets, ceux des piles VPS dans les `.env` de `/opt/hch-*/`, hors dépôt.
- **Aucune écriture dans le vault.** La propagation passe par writeback depuis
  la session vault, après merge.
- **Aucune écriture dans `raw/`** du vault, jamais, sous aucun prétexte.
- **Aucune donnée personnelle réelle** en seed, en fixture ou en test. Le projet
  est pédagogique, le dépôt bascule public avant le 18 août 2026.
- **Aucune décision laissée ouverte par le vault tranchée en autonomie.**
  Une valeur absente d'un ADR ne s'invente pas, même bien raisonnée, même
  documentée après coup dans la PR. Elle se remonte avant d'écrire.
- **Aucun `any`.**
- **Aucun test rendu vert** sans que la règle du test rouge ait été appliquée.

## Où trouver la tâche à faire

`spec-kit/04-tasks-hch.md` et son dossier `04-tasks-hch/` **font foi** sur ce qui
est ouvert, clos et reporté. Le titre d'une tâche close porte `✅ (clos par PR
#N)`, ses DoD sont cochées, et ses écarts vivent dans un bloc *Notes write-back*.

**Cette page ne duplique jamais cet état.** Un « tâche en cours » écrit ici
serait faux dès la tâche suivante et coûterait une synchronisation à chaque
clôture — pour une information que l'étape 1 de ton workflow t'oblige déjà à
lire à la source.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
