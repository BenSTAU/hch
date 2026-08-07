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
    // `localhost` et NON `127.0.0.1` pour le défaut local, contrairement à la
    // règle qui vaut partout ailleurs dans ce dépôt. Le serveur de
    // développement de Next 16 restreint les origines autorisées à charger
    // `/_next/*` (`allowedDevOrigins`), et `127.0.0.1` n'y est pas : les
    // chunks ne se chargent pas, rien n'hydrate, et le `<form>` se soumet
    // NATIVEMENT en GET — avec le mot de passe en query string. Constaté en
    // basculant la valeur, puis reverté.
    //
    // La règle `127.0.0.1` garde tout son sens là où elle est née : le `wget`
    // de BusyBox dans Alpine, qui ne bascule pas d'IPv6 vers IPv4. Chromium,
    // lui, gère `localhost` sans difficulté. En CI, `HCH_E2E_BASE_URL` fournit
    // l'URL et cette ligne n'est pas utilisée.
    baseURL: baseURL ?? "http://localhost:3000",
    browserName: "chromium",
    trace: "on-first-retry",
    ...(basicUser && basicPassword
      ? { httpCredentials: { username: basicUser, password: basicPassword } }
      : {}),
  },

  projects: [
    // Barrière pré-déploiement : tourne contre l'image, base jetable. Ses
    // seuls identifiants sont ceux de `docker-compose.test.yml`, jetables et
    // déjà en clair au dépôt — la trace peut donc être conservée et versée en
    // artefact.
    { name: "barriere", testDir: "./tests/e2e" },

    // Smoke post-déploiement : tourne contre l'environnement réellement servi.
    //
    // ⚠️ `trace: "off"`, et ce n'est pas négociable. Une trace Playwright
    // enregistre les valeurs saisies dans les champs et les en-têtes envoyés :
    // elle contient donc `SEED_ADMIN_PASSWORD` de la pile visée — celui de
    // PRODUCTION pour `deploy-prod` — et l'en-tête `Authorization: Basic` de
    // staging. Le dépôt est public : un artefact GitHub y est téléchargeable
    // sans authentification. Constaté par l'agent testeur sur T-J0-09, en
    // décompressant le rapport et en y retrouvant le mot de passe en clair.
    //
    // Corollaire dans le pipeline : les deux steps de déploiement ne versent
    // AUCUN rapport en artefact. Un smoke rouge se diagnostique sur le log du
    // job, jamais sur une trace.
    { name: "smoke", testDir: "./tests/smoke", use: { trace: "off" } },
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
