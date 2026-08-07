import { defineConfig } from "@playwright/test";
import { config as loadEnvFile } from "dotenv";

// Même chargement que `prisma.config.ts` : Playwright ne lit pas `.env.local`
// nativement, et c'est le seul fichier qui diffère entre les deux postes.
// dotenv n'écrase jamais une variable déjà définie — l'environnement réel
// gagne, ce qui fait fonctionner la CI où aucun de ces fichiers n'existe.
loadEnvFile({ path: ".env.local", quiet: true });
loadEnvFile({ path: ".env", quiet: true });

// La présence de cette variable est ce qui distingue les deux régimes
// d'exécution. Absente : on est en local, Playwright monte `pnpm dev`.
// Présente : une cible existe déjà — l'image dans le job `e2e`, l'URL publique
// dans les smokes — et Playwright ne monte RIEN.
//
// C'est l'amendement ADR-014 du 2026-08-07 : la vraie pipeline de production
// est l'image node:24-alpine, pas un `next start` de runner. Un serveur monté
// par la CI serait un troisième artefact, ni le dev ni la production.
const baseURL = process.env["HCH_E2E_BASE_URL"];

// Staging est derrière `auth_basic` (PLAN S3 §2). Les identifiants viennent des
// secrets de l'Environment `staging` — jamais du dépôt, qui est public.
const basicUser = process.env["HCH_E2E_BASIC_USER"];
const basicPassword = process.env["HCH_E2E_BASIC_PASSWORD"];

const isCI = Boolean(process.env["CI"]);

export default defineConfig({
  testDir: "./tests",

  // Un seul worker, et pas de parallélisme : le scénario écrit dans
  // `app_settings`, dont la mise à jour concurrente est un point ouvert connu
  // (pas de verrou). Deux workers sur la même base produiraient des échecs
  // qu'on imputerait au test.
  fullyParallel: false,
  workers: 1,

  forbidOnly: isCI,
  // Le smoke traverse nginx, TLS et un conteneur qui vient de démarrer :
  // l'aléa réseau existe et n'est pas un défaut applicatif.
  retries: isCI ? 2 : 0,
  reporter: isCI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"] as const],

  use: {
    baseURL: baseURL ?? "http://localhost:3000",
    browserName: "chromium",
    trace: "on-first-retry",
    ...(basicUser && basicPassword
      ? { httpCredentials: { username: basicUser, password: basicPassword } }
      : {}),
  },

  projects: [
    // Barrière pré-déploiement : tourne contre l'image, base jetable.
    { name: "barriere", testDir: "./tests/e2e" },
    // Smoke post-déploiement : tourne contre l'environnement réellement servi.
    { name: "smoke", testDir: "./tests/smoke" },
  ],

  ...(baseURL
    ? {}
    : {
        webServer: {
          command: "pnpm dev",
          url: "http://localhost:3000",
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }),
});
