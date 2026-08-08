// @vitest-environment node
//
// Transport email (ADR-017). Deux régimes, une seule frontière : Gmail par
// mot de passe d'application en production, no-op qui logge le lien partout
// ailleurs. Le point non négociable de l'ADR est l'échec **bruyant** — un envoi
// raté à l'inscription laisse un compte créé et jamais activable, et le client
// n'a aucun recours.
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));

vi.mock("nodemailer", () => ({ createTransport }));

const serverEnv = vi.fn();
vi.mock("@/lib/env", () => ({ serverEnv }));

const { MAIL_SENDER_NAME, sendEmail } = await import("./transport");

const GMAIL = {
  appUrl: "https://hch.glanford.eu",
  mail: {
    transport: "gmail" as const,
    fromAddress: "expediteur@example.test",
    appPassword: "seizecaracteres",
  },
};

const NOOP = {
  appUrl: "http://localhost:3000",
  mail: { transport: "noop" as const },
};

const MESSAGE = {
  to: "client@example.test",
  subject: "Activez votre compte HomeCycl'Home",
  text: "Lien : https://hch.glanford.eu/activation?token=abc",
  html: "<p>Lien</p>",
};

beforeEach(() => {
  vi.clearAllMocks();
  sendMail.mockResolvedValue({ messageId: "<1@example.test>" });
});

describe("sendEmail — transport Gmail", () => {
  beforeEach(() => {
    serverEnv.mockReturnValue(GMAIL);
  });

  it("s'authentifie avec le mot de passe d'application", async () => {
    await sendEmail(MESSAGE);

    expect(createTransport).toHaveBeenCalledWith({
      service: "gmail",
      auth: { user: "expediteur@example.test", pass: "seizecaracteres" },
    });
  });

  it("porte le nom d'expéditeur « HomeCycl'Home »", async () => {
    // ADR-017 §Contraintes : le `from` n'est pas `@glanford.eu`, et c'est le nom
    // affiché qui porte la marque. L'adresse reste visible en second rideau.
    expect(MAIL_SENDER_NAME).toBe("HomeCycl'Home");

    await sendEmail(MESSAGE);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: `"HomeCycl'Home" <expediteur@example.test>`,
      }),
    );
  });

  it("pose un `replyTo`", async () => {
    // Même motif : une réponse à un `from` personnel doit atterrir quelque part
    // de prévisible.
    await sendEmail(MESSAGE);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: "expediteur@example.test" }),
    );
  });

  it("transmet destinataire, objet et corps", async () => {
    await sendEmail(MESSAGE);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: MESSAGE.to,
        subject: MESSAGE.subject,
        text: MESSAGE.text,
        html: MESSAGE.html,
      }),
    );
  });
});

describe("sendEmail — échec bruyant", () => {
  beforeEach(() => {
    serverEnv.mockReturnValue(GMAIL);
  });

  it("propage l'échec au lieu de l'avaler", async () => {
    // Le point le plus important du fichier. Un `catch` silencieux ici est
    // exactement le mode d'échec qu'ADR-017 §Contraintes interdit, et il ne se
    // découvrirait qu'au support client.
    sendMail.mockRejectedValue(new Error("EAUTH: invalid credentials"));

    await expect(sendEmail(MESSAGE)).rejects.toThrow();
  });

  it("nomme le destinataire dans l'erreur, pour que le log serve", async () => {
    sendMail.mockRejectedValue(new Error("EAUTH: invalid credentials"));

    await expect(sendEmail(MESSAGE)).rejects.toThrow(/client@example\.test/);
  });

  it("ne fait pas fuiter le mot de passe d'application dans l'erreur", async () => {
    // Les erreurs remontent dans les logs du conteneur, et `handleServerError`
    // de next-safe-action les journalise. Un secret dans un message d'erreur est
    // un secret dans les journaux.
    sendMail.mockRejectedValue(new Error("EAUTH seizecaracteres refusé"));

    await expect(sendEmail(MESSAGE)).rejects.not.toThrow(/seizecaracteres/);
  });
});

describe("sendEmail — transport no-op", () => {
  beforeEach(() => {
    serverEnv.mockReturnValue(NOOP);
  });

  it("n'ouvre aucune connexion SMTP", async () => {
    await sendEmail(MESSAGE);

    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("logge le corps du message, qui porte le lien", async () => {
    // ADR-017 : « transport no-op qui logge le lien ». C'est ce qui rend
    // l'inscription jouable à la main sur le poste, sans boîte email.
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await sendEmail(MESSAGE);

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("[email:noop]"),
      expect.stringContaining("/activation?token=abc"),
    );

    info.mockRestore();
  });

  it("n'échoue jamais", async () => {
    await expect(sendEmail(MESSAGE)).resolves.toBeUndefined();
  });
});
