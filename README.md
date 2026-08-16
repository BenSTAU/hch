# HomeCycl'Home

Marketplace de réparation de vélo à domicile : le technicien se déplace, le
client réserve en self-service, le paiement est encaissé sur le terrain.

Projet fil rouge de la certification CDA (RNCP 37873), client fictif
LeCycleLyonnais.

## Sommaire

- [Le produit](#le-produit)
- [Démarrer](#démarrer)
- [Commandes](#commandes)
- [Structure](#structure)
- [Stack](#stack)
- [Documentation](#documentation)

## Le produit

Un particulier a un vélo en panne. Plutôt que de le transporter jusqu'à un
atelier, il choisit un forfait, une adresse et un créneau ; un technicien se
déplace avec son matériel et encaisse une fois l'intervention terminée. Le
parcours va de bout en bout sans intervention humaine : pas de demande de devis,
pas de file de leads, pas de rappel commercial.

Trois rôles, cloisonnés :

| Rôle               | Ce qu'il fait                                                                                                       | Où                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Client**         | explore le catalogue et le tunnel sans compte, réserve une fois inscrit et activé, suit et annule ses interventions | `/reserver`, `/mes-interventions/*`, `/mon-compte/*` |
| **Technicien**     | consulte sa tournée du jour, démarre une intervention, joint des photos, clôt avec ou sans encaissement             | `/interventions/*`                                   |
| **Administrateur** | tient les paramètres société, le catalogue et les zones d'intervention                                              | `/admin/*`                                           |

Quatre règles décident de l'essentiel du code, et les enfreindre produit un
programme qui compile et un produit faux :

- **Le technicien se déplace, jamais le client.** Il n'existe aucune entité
  atelier comme lieu d'intervention.
- **Le forfait dicte le créneau.** Aucun créneau n'est stocké : le pool se dérive
  à la volée de `planning(technicien de la zone) x durée(forfait) - créneaux
occupés`.
- **La géographie sectorise.** L'appartenance à une zone se calcule
  géométriquement, par point-in-polygon PostGIS. Une adresse non géocodée bloque
  la réservation.
- **Le paiement est terrain.** Aucune intégration de paiement en ligne n'existe
  ni n'est prévue en v1 ; la table `payments` porte un encaissement déclaratif du
  technicien.

## Démarrer

```bash
pnpm install
pnpm exec prisma generate
pnpm dev
```

L'application est servie sur <http://localhost:3000>.

`prisma generate` est une étape à part entière, pas une précaution : pnpm 10
n'exécute aucun script d'installation sans autorisation, `pnpm install` se
termine sur `Ignored build scripts: @prisma/engines`, et le client n'est pas
généré. Le symptôme apparaît plus tard, au premier accès à la base, sous la forme
`did not initialize yet`.

Les commandes qui touchent la base de données exigent un tunnel SSH ouvert dans
une fenêtre dédiée : la base de développement est **distante et partagée**, il
n'y a pas de base locale à monter.

```bash
ssh -N -L 5433:127.0.0.1:5434 -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes glanfordDeploy
```

**Sur Windows, cloner avec `-c core.autocrlf=false`.** Le clone par défaut sort
en CRLF alors que `.editorconfig` impose `lf`, et chaque passage de Prettier
réécrit les fichiers ensuite.

Séquence complète, variables d'environnement, ports, migrations et pannes
fréquentes : **[`docs/installation.md`](./docs/installation.md)**.

## Commandes

| Commande                          | Effet                                      |
| --------------------------------- | ------------------------------------------ |
| `pnpm dev`                        | Serveur de développement (Turbopack)       |
| `pnpm build`                      | Build de production                        |
| `pnpm start`                      | Sert le build de production                |
| `pnpm lint`                       | ESLint (flat config, `eslint-config-next`) |
| `pnpm format`                     | Prettier + tri des classes Tailwind        |
| `pnpm typecheck`                  | `next typegen` puis `tsc --noEmit`         |
| `pnpm test`                       | Vitest                                     |
| `pnpm test:e2e`                   | Playwright, projet `barriere`              |
| `pnpm exec prisma migrate dev`    | Migration locale                           |
| `pnpm exec prisma migrate deploy` | Migration CI et production                 |
| `pnpm exec prisma db seed`        | Référentiel de départ                      |

Cinq d'entre elles portent un piège qui se paye si on l'ignore.

`pnpm typecheck` appelle `next typegen` d'abord : les types globaux de routage
(`LayoutProps`, `PageProps`) sont générés par Next dans `.next/types/`, et `tsc`
échoue sans eux sur un arbre de travail qui n'a jamais été buildé.

`pnpm format` est Prettier, avec `prettier-plugin-tailwindcss` pour le tri des
classes. L'option `tailwindStylesheet` de `.prettierrc` pointe sur
`src/app/globals.css` : Tailwind v4 est CSS-first, il n'y a aucun fichier de
configuration à lire, et c'est par cette feuille de style que le plugin découvre
nos utilitaires `@theme` (`font-heading`, `bg-primary-fixed`,
`text-tertiary-fixed`). Sans elle il les traiterait comme des classes inconnues
et les rejetterait en tête de liste. Le lint reste à ESLint, séparément.

`pnpm test:e2e` exige Docker : le projet `barriere` teste l'image de production
derrière un vrai Postgres + PostGIS monté par `docker-compose.test.yml`. Les
tests unitaires, eux, n'en ont pas besoin.

`prisma migrate dev` est réservé au local et peut proposer un reset de la base de
développement. Sans conséquence, elle n'a pas de travail concurrent, mais ce
n'est pas la commande de production : c'est `migrate deploy`, en CI comme sur le
VPS.

`prisma db seed` est rejouable, il travaille par upsert. Il échoue explicitement
si `SEED_ADMIN_PASSWORD` est absente, aucun mot de passe n'étant écrit en dur
dans un dépôt public.

## Structure

```
src/
  app/            routing App Router seul, plus les _components/ co-localisés
    (marketing)/  (auth)/  (tunnel)/  (app)/   route groups
    api/          les 3 Route Handlers, cf. docs/api.md
  components/     ui/ primitives shadcn · features/<domaine>/ · layouts/
  lib/            tout le serveur, n'importe jamais depuis components/ ni app/
    actions/<domaine>/   Server Actions (next-safe-action)
    db/queries/          helpers métier, testables hors contexte Next
    validations/         schémas Zod, source unique des types d'entrée
    auth/ geo/ email/ audit/ creneaux/ photos/ paiements/
  hooks/  stores/  mocks/  types/
  proxy.ts        redirect optimiste sur présence du cookie, jamais le rempart
prisma/           schema.prisma, 16 migrations, seed.ts
tests/            E2E Playwright (les tests unitaires sont co-localisés)
```

Dix domaines métier portent **le même nom partout** : `auth`, `users`,
`adresses`, `cycles`, `interventions`, `zones`, `forfaits`, `produits`,
`paiements`, `parametres`. Les routes sont en français, les noms de fichiers de
composants en anglais.

`clients/` et `techniciens/` n'existent pas comme domaines : ce sont des `users`
porteurs d'un rôle, et la distinction vit dans les routes et dans
`lib/auth/permissions.ts`.

## Stack

| Couche      | Choix                                                                                     | Version                      |
| ----------- | ----------------------------------------------------------------------------------------- | ---------------------------- |
| Application | Next.js App Router, un seul processus, RSC par défaut                                     | `16.3.0`                     |
| UI          | React, Tailwind v4 CSS-first (sans fichier de configuration), shadcn/ui sur Radix, Lucide | React `19.2.8`               |
| Mutations   | Server Actions via `next-safe-action`, schémas Zod                                        | `8.6` · Zod 4                |
| Base        | PostgreSQL + PostGIS                                                                      | `postgis/postgis:16-3.4`     |
| ORM         | Prisma, `Unsupported("geography")` et `$queryRaw` pour PostGIS                            | `6.19.2`                     |
| Auth        | roll-your-own : bcrypt + `jose`, sessions JWT en cookie `httpOnly`                        | choix pédagogique assumé     |
| Carto       | BAN / Géoplateforme IGN côté client (sans clé) · Google Maps au back-office               |                              |
| Tests       | Vitest + Testing Library + MSW, Playwright, `jest-axe`                                    | 115 fichiers, 1706 tests     |
| Runtime     | Node LTS, pnpm                                                                            | Node `>=24` · pnpm `10.33.2` |
| Déploiement | Docker, VPS OVH, GitHub Actions, image unique promue par SHA                              |                              |

Trois absences sont des décisions, pas des oublis : **aucune bibliothèque
d'authentification** tierce, **aucun fichier `tailwind.config`**, **aucun
MongoDB** en v1.

## Documentation

| Document                                           | Contenu                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`docs/installation.md`](./docs/installation.md)   | prérequis, clone, variables d'environnement, ports, tunnel, migrations, pannes fréquentes |
| [`docs/api.md`](./docs/api.md)                     | les 3 Route Handlers et les 26 Server Actions, avec leur garde et leur effet              |
| [`docs/api/openapi.yaml`](./docs/api/openapi.yaml) | les routes HTTP en OpenAPI 3.1                                                            |
| [`CLAUDE.md`](./CLAUDE.md)                         | conventions du dépôt, règles métier, cadre de l'assistance IA                             |

Les artefacts de conception (Constitution, SPEC, PLAN, TASKS, ADR, dictionnaire
de données, maquettes) **ne vivent pas dans ce dépôt**. Ils habitent un vault
Obsidian compagnon, qui fait foi sur la conception : ce dépôt fait foi sur ce qui
est implémenté. Le chemin du vault et la règle de propagation sont décrits dans
[`CLAUDE.md`](./CLAUDE.md).
