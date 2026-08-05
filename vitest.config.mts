import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
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
