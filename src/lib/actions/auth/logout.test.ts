// @vitest-environment node
//
// Server Action de déconnexion — `US-COMPTE-DECONNECTER`.
//
// L'US insiste sur un point qui gouverne tout le fichier : l'action est
// **idempotente**. Un lien mis en favori, un second onglet, un bouton cliqué
// deux fois — aucun de ces cas ne doit produire d'erreur, ni 401 ni 403. Sans
// session, il n'y a rien à faire et c'est déjà le résultat attendu.
import { beforeEach, describe, expect, it, vi } from "vitest";

const destroySession = vi.fn();
const readSessionToken = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  destroySession: () => destroySession(),
  readSessionToken: () => readSessionToken(),
}));

// Même mock que dans `login.test.ts` : `redirect()` fonctionne par throw, et un
// mock qui se contenterait d'enregistrer laisserait passer un code qui continue
// après la redirection.
const redirect = vi.fn((url: string) => {
  throw Object.assign(new Error("NEXT_REDIRECT"), {
    digest: `NEXT_REDIRECT;push;${url};307;`,
  });
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));

const { logout } = await import("./logout");
// La destination est déclarée avec celles de la connexion : un fichier
// `"use server"` n'exporte que des fonctions asynchrones, et Next refuse le
// build sur une constante exportée — constaté au premier `pnpm dev` de la
// barrière, pas en relisant le fichier.
const { AFTER_LOGOUT } = await import("@/lib/auth/after-login");

beforeEach(() => vi.clearAllMocks());

describe("logout", () => {
  it("efface le cookie de session", async () => {
    await logout().catch(() => undefined); // redirect() lève

    expect(destroySession).toHaveBeenCalledOnce();
  });

  it("ramène à l'accueil", async () => {
    // DoD T-V3-03 : « cookie invalidé, retour à l'accueil ». La SPEC nuançait
    // selon le rôle précédent — le rôle n'est plus lisible une fois la session
    // détruite, et la DoD tranche une destination unique.
    await logout().catch(() => undefined);

    expect(redirect).toHaveBeenCalledWith(AFTER_LOGOUT);
    expect(AFTER_LOGOUT).toMatch(/^\/(?![/\\])/);
  });

  it("efface AVANT de rediriger", async () => {
    // `redirect()` lève : tout ce qui vient après ne s'exécute pas. Inverser
    // l'ordre laisserait la session intacte et la déconnexion serait purement
    // décorative.
    await logout().catch(() => undefined);

    expect(destroySession.mock.invocationCallOrder[0]).toBeLessThan(
      redirect.mock.invocationCallOrder[0]!,
    );
  });

  it("reste sans erreur quand aucune session n'existe", async () => {
    // §Cas d'erreur : « aucune erreur — je suis redirigé vers la page publique
    // (comportement idempotent) ». `cookies().delete()` sur un cookie absent
    // est un non-événement ; ce test verrouille qu'aucune garde ne vient
    // s'interposer pour en faire un échec.
    destroySession.mockResolvedValue(undefined);

    await expect(logout()).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expect(redirect).toHaveBeenCalledWith(AFTER_LOGOUT);
  });

  it("ne lit jamais la session avant de la détruire", async () => {
    // Une lecture préalable rendrait l'action dépendante d'un jeton VALIDE :
    // un cookie expiré, ou signé avec un secret depuis remplacé, ne pourrait
    // plus être effacé et la personne resterait coincée avec un cookie mort
    // que `src/proxy.ts` continue de prendre pour une session.
    await logout().catch(() => undefined);

    expect(readSessionToken).not.toHaveBeenCalled();
  });
});
