import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `import 'server-only'` est une garde de build : le paquet expose un
      // module vide sous la condition `react-server`, et un module qui LÈVE
      // partout ailleurs. Vitest n'est ni l'un ni l'autre, il tombe donc sur
      // la version qui lève, et tout module marqué server-only devient
      // intestable — DAL, session, requêtes Prisma, soit exactement le code
      // de sécurité qu'on doit couvrir.
      //
      // On neutralise la garde ICI, dans le runner, sans toucher aux modules.
      // La protection réelle reste entière : c'est `next build` qui refuse un
      // import server-only depuis un Client Component, pas Vitest.
      "server-only": fileURLToPath(
        new URL("./src/test/server-only.stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Tests co-localisés à côté du module. `tests/` est réservé aux golden
    // paths Playwright, montés en T-J0-09 — Vitest ne doit pas les ramasser.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
