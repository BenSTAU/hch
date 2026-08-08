// @vitest-environment node
//
// Gabarit de l'email d'activation — le premier des six emails de v1
// (ADR-017 §Périmètre). Le contenu n'était tranché nulle part avant le
// 2026-08-08 : module-1-utilisateurs.md:196 le renvoyait au PLAN, qui ne l'a
// jamais écrit. Ce que la SPEC contraint réellement, c'est le TTL de 24 h et le
// fait que le lien porte le jeton en clair.
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.fn();
vi.mock("./transport", () => ({ sendEmail }));

const serverEnv = vi.fn();
vi.mock("@/lib/env", () => ({ serverEnv }));

const { activationUrl, sendActivationEmail } = await import("./activation");

const JETON = "aaaabbbbccccddddeeeeffffgggghhhhiiiijjjjkkk";

beforeEach(() => {
  vi.clearAllMocks();
  serverEnv.mockReturnValue({
    appUrl: "https://hch.glanford.eu",
    mail: { transport: "noop" as const },
  });
});

describe("activationUrl", () => {
  it("construit une URL absolue depuis l'URL publique", () => {
    // Un lien relatif dans un email n'est pas cliquable : le client de
    // messagerie n'a aucune origine à laquelle le rattacher.
    expect(activationUrl(JETON)).toBe(
      `https://hch.glanford.eu/activation?token=${JETON}`,
    );
  });

  it("ne double pas la barre oblique quand l'URL publique en porte une", () => {
    serverEnv.mockReturnValue({
      appUrl: "https://hch.glanford.eu/",
      mail: { transport: "noop" as const },
    });

    expect(activationUrl(JETON)).toBe(
      `https://hch.glanford.eu/activation?token=${JETON}`,
    );
  });

  it("encode le jeton dans la query string", () => {
    expect(activationUrl("a b+c")).toContain("token=a%20b%2Bc");
  });

  it("route en français, conformément aux conventions du dépôt", () => {
    // La SPEC écrit `GET /auth/verify?token=` (module-1-utilisateurs.md:211).
    // CLAUDE.md §Folder structure impose les routes en français — écart signalé
    // dans le body de PR, pas absorbé.
    expect(activationUrl(JETON)).toContain("/activation?");
    expect(activationUrl(JETON)).not.toContain("/auth/verify");
  });
});

describe("sendActivationEmail", () => {
  it("adresse le message au compte qui vient d'être créé", async () => {
    await sendActivationEmail({
      to: "client@example.test",
      firstname: "Camille",
      token: JETON,
    });

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "client@example.test" }),
    );
  });

  it("nomme HomeCycl'Home dans l'objet", async () => {
    await sendActivationEmail({
      to: "client@example.test",
      firstname: "Camille",
      token: JETON,
    });

    const [message] = sendEmail.mock.calls[0] as [{ subject: string }];
    expect(message.subject).toContain("HomeCycl'Home");
  });

  it("porte le lien d'activation en texte brut ET en HTML", async () => {
    // Le texte brut n'est pas décoratif : c'est ce que lit le transport no-op,
    // et c'est le repli des clients de messagerie qui refusent le HTML.
    await sendActivationEmail({
      to: "client@example.test",
      firstname: "Camille",
      token: JETON,
    });

    const [message] = sendEmail.mock.calls[0] as [
      { text: string; html: string },
    ];
    expect(message.text).toContain(activationUrl(JETON));
    expect(message.html).toContain(activationUrl(JETON));
  });

  it("annonce les 24 heures de validité", async () => {
    // Sans ça, un lien mort n'a aucune explication du point de vue du client.
    await sendActivationEmail({
      to: "client@example.test",
      firstname: "Camille",
      token: JETON,
    });

    const [message] = sendEmail.mock.calls[0] as [{ text: string }];
    expect(message.text).toContain("24 heures");
  });

  it("échappe le prénom dans le corps HTML", async () => {
    // `firstname` vient d'un formulaire public. Les clients de messagerie
    // modernes n'exécutent pas de script, mais ils interprètent le balisage :
    // une valeur non échappée casse la mise en page, et rien ne garantit le
    // comportement d'un webmail plus permissif.
    await sendActivationEmail({
      to: "client@example.test",
      firstname: '<img src=x onerror="alert(1)">',
      token: JETON,
    });

    const [message] = sendEmail.mock.calls[0] as [{ html: string }];
    expect(message.html).not.toContain("<img");
    expect(message.html).toContain("&lt;img");
  });

  it("propage l'échec du transport", async () => {
    // ADR-017 : l'échec doit remonter jusqu'à l'inscription, qui doit le dire.
    sendEmail.mockRejectedValue(new Error("EAUTH"));

    await expect(
      sendActivationEmail({
        to: "client@example.test",
        firstname: "Camille",
        token: JETON,
      }),
    ).rejects.toThrow();
  });
});
