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
# T-J0-03 — à activer avec l'arrivée de Prisma :
# RUN pnpm prisma generate
RUN pnpm build

# ─────────────────────────────────────────────────────────────────────────
# Stage 3 — runner : image finale, utilisateur non-root, port 3000.
# ─────────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# T-J0-03 — CLI Prisma global, requis par le `prisma migrate deploy` que le
# pipeline lance en conteneur éphémère. Il s'installe ICI, en root, pour que
# ses engines soient pré-téléchargés au build : sous `USER nextjs` (UID 1001)
# le runtime ne peut plus écrire, et un CLI qui tente de les tirer à
# l'exécution échoue. Piège payé sur Argo (fix T-T11-03).
# RUN npm install -g prisma@<version alignée sur le package.json>

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# T-J0-03 — `prisma/` porte le schema que lit `migrate deploy` au
# déploiement. Pas de `COPY node_modules/.prisma` : ce chemin n'existe pas
# sous pnpm, le client est embarqué par `outputFileTracingIncludes`.
# COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
