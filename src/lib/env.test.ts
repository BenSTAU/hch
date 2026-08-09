// @vitest-environment node
//
// Garde d'environnement. Deux propriétés comptent ici et une seule est
// évidente : que le schéma refuse une configuration incomplète, et qu'il ne le
// fasse **jamais au chargement du module**. Le second point a un précédent —
// le helper `env()` de `prisma.config.ts` levait à l'import, donc aussi pour
// `prisma generate`, alors que le stage builder du Dockerfile n'a aucune de ces
// variables (write-back PR #3 note 2).
import { afterEach, describe, expect, it, vi } from "vitest";

import { serverEnv } from "./env";

const COMPLET = {
  DATABASE_URL: "postgresql://hch:hch@localhost:5433/hch",
  SESSION_SECRET: "un-secret-de-test-de-plus-de-32-octets",
  HCH_MAIL_TRANSPORT: "gmail",
  GMAIL_APP_PASSWORD: "seizecaracteres",
  GMAIL_FROM_ADDRESS: "expediteur@example.test",
  NEXT_PUBLIC_APP_URL: "https://hch.glanford.eu",
} as const;

function poser(vars: Record<string, string | undefined>): void {
  for (const [nom, valeur] of Object.entries(vars)) {
    vi.stubEnv(nom, valeur);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("serverEnv — configuration complète", () => {
  it("expose la base, le secret de session et l'URL publique", () => {
    poser(COMPLET);

    const env = serverEnv();

    expect(env.databaseUrl).toBe(COMPLET.DATABASE_URL);
    expect(env.sessionSecret).toBe(COMPLET.SESSION_SECRET);
    expect(env.appUrl).toBe("https://hch.glanford.eu");
  });

  it("expose le transport Gmail avec ses identifiants", () => {
    poser(COMPLET);

    const { mail } = serverEnv();

    expect(mail).toEqual({
      transport: "gmail",
      fromAddress: "expediteur@example.test",
      appPassword: "seizecaracteres",
    });
  });
});

describe("serverEnv — transport no-op", () => {
  it("n'exige aucun identifiant Gmail quand le transport est no-op", () => {
    // C'est le régime du poste de développement et celui de la barrière E2E :
    // `docker-compose.test.yml` ne porte que DATABASE_URL, SESSION_SECRET et
    // SEED_ADMIN_PASSWORD. Exiger les identifiants Gmail y rendrait
    // `/api/health` rouge, donc le conteneur unhealthy, donc le job `e2e` rouge.
    poser({
      ...COMPLET,
      HCH_MAIL_TRANSPORT: "noop",
      GMAIL_APP_PASSWORD: undefined,
      GMAIL_FROM_ADDRESS: undefined,
      NEXT_PUBLIC_APP_URL: undefined,
    });

    const env = serverEnv();

    expect(env.mail).toEqual({ transport: "noop" });
  });

  it("retombe sur localhost quand l'URL publique n'est pas fournie", () => {
    poser({
      ...COMPLET,
      HCH_MAIL_TRANSPORT: "noop",
      NEXT_PUBLIC_APP_URL: undefined,
    });

    expect(serverEnv().appUrl).toBe("http://localhost:3000");
  });
});

describe("serverEnv — refus", () => {
  it("refuse un transport absent plutôt que d'en choisir un", () => {
    // Aucune valeur par défaut, et c'est le cœur de la décision : un défaut à
    // `noop` ferait qu'une pile de production mal configurée n'enverrait plus
    // rien, sans que rien ne le signale. ADR-017 exige l'inverse — l'échec doit
    // être bruyant.
    poser({ ...COMPLET, HCH_MAIL_TRANSPORT: undefined });

    expect(() => serverEnv()).toThrow(/HCH_MAIL_TRANSPORT/);
  });

  it("refuse une valeur de transport inconnue", () => {
    poser({ ...COMPLET, HCH_MAIL_TRANSPORT: "sendmail" });

    expect(() => serverEnv()).toThrow(/HCH_MAIL_TRANSPORT/);
  });

  it("refuse le transport Gmail sans mot de passe d'application", () => {
    poser({ ...COMPLET, GMAIL_APP_PASSWORD: undefined });

    expect(() => serverEnv()).toThrow(/GMAIL_APP_PASSWORD/);
  });

  it("refuse le transport Gmail sans adresse d'expédition", () => {
    poser({ ...COMPLET, GMAIL_FROM_ADDRESS: undefined });

    expect(() => serverEnv()).toThrow(/GMAIL_FROM_ADDRESS/);
  });

  it("refuse le transport Gmail sans URL publique", () => {
    // Sans elle, le lien d'activation part en relatif : un email inutilisable.
    poser({ ...COMPLET, NEXT_PUBLIC_APP_URL: undefined });

    expect(() => serverEnv()).toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it("refuse une base absente", () => {
    poser({ ...COMPLET, DATABASE_URL: undefined });

    expect(() => serverEnv()).toThrow(/DATABASE_URL/);
  });

  it("refuse un secret de session absent", () => {
    poser({ ...COMPLET, SESSION_SECRET: undefined });

    expect(() => serverEnv()).toThrow(/SESSION_SECRET/);
  });

  it("nomme TOUTES les variables fautives, pas seulement la première", () => {
    // Un message qui n'en nomme qu'une transforme un diagnostic en boucle :
    // corriger, redéployer, découvrir la suivante. Sur une pile distante ça
    // coûte un cycle de déploiement complet par variable.
    poser({
      ...COMPLET,
      DATABASE_URL: undefined,
      SESSION_SECRET: undefined,
    });

    expect(() => serverEnv()).toThrow(/DATABASE_URL[\s\S]*SESSION_SECRET/);
  });
});

describe("serverEnv — la garde n'est pas évaluée à l'import", () => {
  it("charge le module sans lever, même sans aucune variable", async () => {
    // Le stage builder du Dockerfile n'a AUCUNE de ces variables, et il importe
    // ce module par transitivité dès qu'un composant serveur le touche. Une
    // évaluation au chargement casserait `docker build`, pas seulement le
    // runtime — précédent exact de `prisma.config.ts`.
    poser({
      DATABASE_URL: undefined,
      SESSION_SECRET: undefined,
      HCH_MAIL_TRANSPORT: undefined,
      GMAIL_APP_PASSWORD: undefined,
      GMAIL_FROM_ADDRESS: undefined,
      NEXT_PUBLIC_APP_URL: undefined,
    });
    vi.resetModules();

    await expect(import("./env")).resolves.toHaveProperty("serverEnv");
  });
});
