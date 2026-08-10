# Image de production HomeCycl'Home — multi-stage deps → builder → runner.
# L'image finale ne contient ni pnpm ni sources TypeScript : uniquement la
# sortie standalone de Next (cf. next.config.ts, `output: "standalone"`).
#
# Build local : docker build -t hch-test .
# Build CI    : job `build-push` de .github/workflows/deploy.yml (T-J0-08),
#               poussé vers benstau/hch:<sha> et benstau/hch:latest.
#
# Node 24 sur toute la chaîne — `engines` du package.json, cette image, et
# `actions/setup-node` du pipeline. Node 22 meurt le 30/04/2027, pendant la
# soutenance (amendement PLAN S3 du 2026-08-05).

# ─────────────────────────────────────────────────────────────────────────
# Stage 1 — deps : node_modules à partir du lockfile gelé.
# Couche de cache réutilisée tant que les trois fichiers copiés ne bougent
# pas. `pnpm-workspace.yaml` fait partie du contrat : il porte
# `ignoredBuiltDependencies`, que pnpm 10 relit à chaque install.
# ─────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ─────────────────────────────────────────────────────────────────────────
# Stage 2 — builder : compile Next en mode standalone.
# `.dockerignore` est ce qui rend le `COPY . .` sûr : sans lui il écraserait
# les node_modules Alpine du stage `deps` par ceux de l'hôte Windows, et
# donnerait à `next build` le `.env.local` du poste au lieu de la
# configuration d'environnement de la pile visée.
# ─────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app
RUN corepack enable pnpm
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Le client Prisma est généré avant le build : Next trace ses fichiers pendant
# la compilation, et il ne peut tracer que ce qui existe déjà.
# `prisma.config.ts` est lu ici et ne réclame pas de
# DATABASE_URL — c'est délibéré, le stage builder n'en a pas.
RUN pnpm prisma generate
RUN pnpm build

# Le seed est du TypeScript, exécuté en local par `tsx` via la clé
# `migrations.seed` de prisma.config.ts. Rien de tout ça ne survit dans l'image :
# ni tsx ni dotenv ne sont des dépendances de l'application, donc le File
# Tracing de Next ne les embarque pas, et prisma.config.ts n'est pas copié au
# runner (cf. plus bas). On transpile donc ici, en CommonJS.
#
# `--bundle` absorbe dotenv dans le fichier de sortie ; `--external` laisse
# dehors les deux seuls paquets que la sortie standalone fournit déjà,
# @prisma/client et bcrypt. Résultat : un fichier autonome que `node` exécute
# depuis /app sans aucune installation supplémentaire. Le seed source n'est pas
# modifié — il tourne à l'identique en local par `prisma db seed`.
RUN pnpm exec esbuild prisma/seed.ts \
      --bundle --platform=node --target=node24 --format=cjs \
      --external:@prisma/client --external:bcrypt \
      --outfile=prisma/seed.js

# ─────────────────────────────────────────────────────────────────────────
# Stage 3 — runner : image finale, utilisateur non-root, port 3000.
# ─────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# CLI Prisma global, requis par le `prisma migrate deploy` que le pipeline
# lance en conteneur éphémère. Il s'installe ICI, en root, pour que ses engines
# soient pré-téléchargés au build : sous `USER nextjs` (UID 1001) le runtime ne
# peut plus écrire, et un CLI qui tente de les tirer à l'exécution échoue.
# Piège payé sur Argo (fix T-T11-03).
#
# Version figée sur celle du package.json — un CLI en avance sur le client
# produit des migrations que le runtime ne sait pas lire.
RUN npm install -g prisma@6.19.2

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# `prisma/` porte le schema et les migrations que lit `migrate deploy` au
# déploiement, ainsi que le `seed.js` transpilé au stage builder. Pas de
# `COPY node_modules/.prisma` : ce chemin n'existe pas
# sous pnpm — le client est embarqué par le File Tracing de Next, qui le
# trace seul depuis le retrait d'`outputFileTracingIncludes` (cf. next.config.ts).
#
# `prisma.config.ts` reste à la racine et n'est PAS copié : il importe dotenv,
# absent de l'installation globale du CLI. Sans lui le CLI reprend ses
# défauts — `prisma/schema.prisma` et DATABASE_URL depuis l'environnement du
# conteneur, exactement ce que fournit `env_file` en production.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# Dépôt des photos d'intervention. Créé ICI, en root, puis donné à nextjs :
# sous USER nextjs (UID 1001) le runtime ne peut pas créer un dossier dans
# /app, qui appartient à root. `mkdir({recursive:true})` de
# src/lib/photos/stockage.ts échoue alors en EACCES, et l'upload rend une
# erreur que rien n'attrape avant la barrière.
# Relevé sur le run CI 31384530544 (job e2e, GP-02 complet).
RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
