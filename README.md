# HomeCycl'Home

Marketplace de réparation de vélo à domicile : le technicien se déplace, le
client réserve en self-service, le paiement est encaissé sur le terrain.

Projet fil rouge de la certification CDA (RNCP 37873), client fictif
LeCycleLyonnais. Les artefacts de conception — Constitution, SPEC, PLAN, TASKS,
ADR — vivent dans le vault Obsidian compagnon, pas dans ce dépôt. Voir
[CLAUDE.md](./CLAUDE.md).

## Démarrer

```bash
pnpm install
pnpm dev
```

L'application est servie sur <http://localhost:3000>.

Les commandes qui touchent la base de données exigent le tunnel SSH ouvert dans
une fenêtre dédiée — la base de développement est distante, cf. CLAUDE.md
§Deux postes de développement.

## Commandes

| Commande         | Effet                                      |
| ---------------- | ------------------------------------------ |
| `pnpm dev`       | Serveur de développement (Turbopack)       |
| `pnpm build`     | Build de production                        |
| `pnpm start`     | Sert le build de production                |
| `pnpm lint`      | ESLint (flat config, `eslint-config-next`) |
| `pnpm format`    | Prettier + tri des classes Tailwind        |
| `pnpm typecheck` | `next typegen` puis `tsc --noEmit`         |
| `pnpm test`      | Vitest                                     |

`pnpm typecheck` appelle `next typegen` d'abord : les types globaux de routage
(`LayoutProps`, `PageProps`) sont générés par Next dans `.next/types/`, et
`tsc` échoue sans eux sur un arbre de travail qui n'a jamais été buildé.

`pnpm format` est Prettier, avec `prettier-plugin-tailwindcss` pour le tri des
classes. L'option `tailwindStylesheet` de `.prettierrc` pointe sur
`src/app/globals.css` : Tailwind v4 est CSS-first, il n'y a aucun fichier de
configuration à lire, et c'est par cette feuille de style que le plugin découvre
nos utilitaires `@theme` (`font-heading`, `bg-primary-fixed`,
`text-tertiary-fixed`). Sans elle il les traiterait comme des classes inconnues
et les rejetterait en tête de liste. Le lint reste à ESLint, séparément.

## Stack

Next.js 16 App Router · React 19 · TypeScript strict · Tailwind v4 (CSS-first,
sans fichier de configuration) · shadcn/ui sur Radix Primitives · Prisma +
PostgreSQL/PostGIS · Vitest + Testing Library · Playwright.
