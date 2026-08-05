import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Build standalone : Next émet `.next/standalone/server.js` avec les seules
  // dépendances runtime, copié tel quel dans l'image (cf. Dockerfile, stage
  // runner). `public/` et `.next/static` ne sont PAS embarqués par Next — le
  // Dockerfile les copie explicitement.
  output: "standalone",
  // PAS d'`outputFileTracingIncludes` pour Prisma — retiré en T-J0-03, contre
  // le MUST de CLAUDE.md §Docker et le fix Argo T-T11-02 dont il vient.
  //
  // Ce fix datait de juin 2026, sur Next 16.0.x et Prisma 6.1. Sur Next 16.3 +
  // Prisma 6.19.2 il ne sert plus et il CASSE : le traçage suit les globs dans
  // le store pnpm, tombe sur `@prisma+engines/node_modules/@prisma/debug` —
  // un lien symbolique vers un répertoire — et tente de le lire comme un
  // fichier. `pnpm build` et `docker build` échouent tous deux en
  // TurbopackInternalError.
  //
  // Sans les globs, le File Tracing embarque le client de lui-même :
  // `libquery_engine-linux-musl-openssl-3.0.x.so.node` et `schema.prisma` sont
  // présents dans l'image, vérifié au `docker run`. Le filet de sécurité qui
  // disparaît est réel, et c'est le pipeline qui le remplace : un moteur
  // manquant fait répondre 503 à /api/health, donc rollback automatique.
  experimental: {
    // `lucide-react` figure déjà dans la liste optimisée par défaut de Next 16
    // (node_modules/next/dist/docs/01-app/03-api-reference/05-config/
    // 01-next-config-js/optimizePackageImports.md) — il est listé pour
    // l'intention, pas pour l'effet. `zod` n'y figure pas : c'est lui qui rend
    // l'option utile ici.
    optimizePackageImports: ["lucide-react", "zod"],
  },
};

export default nextConfig;
