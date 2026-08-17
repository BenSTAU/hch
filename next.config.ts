import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Build standalone : Next émet `.next/standalone/server.js` avec les seules
  // dépendances runtime, copié tel quel dans l'image (cf. Dockerfile, stage
  // runner). `public/` et `.next/static` ne sont PAS embarqués par Next — le
  // Dockerfile les copie explicitement.
  output: "standalone",
  // ⚠️ **PAS d'`outputFileTracingIncludes` pour Prisma**, contre le MUST de
  // CLAUDE.md §Docker : sur Next 16.3 + Prisma 6.19.2, le traçage suit les
  // globs dans le store pnpm et tente de lire un lien symbolique comme un
  // fichier, donc `pnpm build` et `docker build` cassent tous les deux.
  //
  // Sans eux, le File Tracing embarque le client de lui-même. Le filet perdu
  // est réel : un moteur manquant ne se voit plus qu'au 503 de /api/health,
  // donc après déploiement.
  experimental: {
    // Active `forbidden()` et `src/app/forbidden.tsx`. Sans lui, un rôle
    // insuffisant ne peut être refusé que par une redirection ou une page
    // vide. Marqué `experimental` en amont : c'est le prix d'un 403 qui pose
    // `noindex` et interrompt le rendu sans être réimplémenté à la main.
    authInterrupts: true,
    // `lucide-react` figure déjà dans la liste optimisée par défaut de Next 16,
    // il est listé pour l'intention. `zod` est le seul des deux qui rende
    // l'option utile.
    optimizePackageImports: ["lucide-react", "zod"],
  },
};

export default nextConfig;
