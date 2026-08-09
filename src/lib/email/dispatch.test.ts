// @vitest-environment node
//
// Ordonnancement des envois hors du chemin de réponse. Le module est une couture
// d'une dizaine de lignes, et c'est précisément pour ça qu'il mérite un test :
// tout le reste du parcours d'inscription dépend de deux propriétés qui vivent
// ici — l'envoi n'est pas attendu, et son échec ne remonte jamais à l'appelant.
import { beforeEach, describe, expect, it, vi } from "vitest";

const after = vi.fn();
vi.mock("next/server", () => ({
  after: (callback: () => void) => after(callback),
}));

const { dispatchEmail } = await import("./dispatch");

beforeEach(() => vi.clearAllMocks());

describe("dispatchEmail", () => {
  it("confie l'envoi à `after` sans l'exécuter tout de suite", async () => {
    // La propriété qui ferme le canal temporel : au retour de `dispatchEmail`,
    // rien n'a encore été envoyé, donc la durée de la réponse ne dépend pas de
    // l'aller-retour SMTP.
    const envoyer = vi.fn().mockResolvedValue(undefined);

    dispatchEmail("activation", envoyer);

    expect(after).toHaveBeenCalledOnce();
    expect(envoyer).not.toHaveBeenCalled();
  });

  it("exécute l'envoi quand `after` déroule son rappel", async () => {
    const envoyer = vi.fn().mockResolvedValue(undefined);

    dispatchEmail("activation", envoyer);
    await (after.mock.calls[0]![0] as () => Promise<void>)();

    expect(envoyer).toHaveBeenCalledOnce();
  });

  it("journalise un échec au lieu de le laisser remonter", async () => {
    // ADR-017 exige un échec bruyant. Depuis l'arbitrage B2 du 2026-08-08, le
    // bruit est côté exploitant : la réponse utilisateur reste uniforme
    // (Constitution §4.2), le log porte le détail.
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    const envoyer = vi.fn().mockRejectedValue(new Error("EAUTH"));

    dispatchEmail("activation camille@example.test", envoyer);
    const rappel = after.mock.calls[0]![0] as () => Promise<void>;

    await expect(rappel()).resolves.toBeUndefined();
    expect(erreur).toHaveBeenCalledWith(
      expect.stringContaining("activation camille@example.test"),
      expect.any(Error),
    );

    erreur.mockRestore();
  });

  it("nomme le destinataire dans le log, pour que la trace serve", async () => {
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    dispatchEmail("activation camille@example.test", () =>
      Promise.reject(new Error("EAUTH")),
    );
    await (after.mock.calls[0]![0] as () => Promise<void>)();

    expect(erreur.mock.calls[0]?.[0]).toContain("camille@example.test");

    erreur.mockRestore();
  });
});
