import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Build standalone : Next émet `.next/standalone/server.js` avec les seules
  // dépendances runtime, copié tel quel dans l'image (cf. Dockerfile, stage
  // runner). `public/` et `.next/static` ne sont PAS embarqués par Next — le
  // Dockerfile les copie explicitement.
  output: "standalone",
  // Next File Tracing ne suit pas les `require()` dynamiques de Prisma : les
  // engines binaires sont résolus à l'exécution selon la plateforme. Sous
  // pnpm, le client vit dans `node_modules/.pnpm/@prisma+client*/` et non
  // sous `node_modules/.prisma/`, et le tracing rate toute l'arborescence.
  // Globs repris du fix Argo T-T11-02, validé en production.
  // Ils ne matchent encore rien : Prisma est installé en T-J0-03.
  outputFileTracingIncludes: {
    "**/*": [
      "./node_modules/.pnpm/@prisma+client*/node_modules/.prisma/**/*",
      "./node_modules/.pnpm/@prisma+client*/node_modules/@prisma/client/**/*",
      "./prisma/**/*",
    ],
  },
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
