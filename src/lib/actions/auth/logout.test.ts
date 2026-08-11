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

// Trace `LOGOUT`, ajoutée par T-V3-10 (migration 014, report de T-V3-03).
const writeAuditLog = vi.fn();
vi.mock("@/lib/audit/log", () => ({
  writeAuditLog: (entree: unknown) => writeAuditLog(entree),
  ENTITE_SESSION: "session",
}));

const { logout } = await import("./logout");
// La destination est déclarée avec celles de la connexion : un fichier
// `"use server"` n'exporte que des fonctions asynchrones, et Next refuse le
// build sur une constante exportée — constaté au premier `pnpm dev` de la
// barrière, pas en relisant le fichier.
const { AFTER_LOGOUT } = await import("@/lib/auth/after-login");

const UTILISATEUR = "3f1e0a5c-0b2d-4c6e-9a11-2b3c4d5e6f70";

beforeEach(() => {
  vi.clearAllMocks();
  // Session lisible par défaut : c'est le cas nominal, et les tests du jeton
  // illisible posent explicitement `null`.
  readSessionToken.mockResolvedValue({ sub: UTILISATEUR, roles: [] });
});

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

  // ⚠️ **Oracle remplacé par T-V3-10, règle du test rouge cas 3.** Le test
  // asseyait la propriété sur un détail d'implémentation — « `readSessionToken`
  // n'est jamais appelée » — et T-V3-10 doit lire la session pour nommer
  // l'acteur de la trace `LOGOUT` (`audit_logs.actor_id` est une FK NOT NULL).
  // La lecture ne CONDITIONNE rien, et c'est cela que la propriété exige. Les
  // deux tests ci-dessous l'affirment directement, au lieu d'en surveiller un
  // symptôme.
  it("détruit la session même quand le jeton est illisible", async () => {
    // Un cookie expiré, ou signé avec un secret depuis remplacé, doit pouvoir
    // être effacé : c'est précisément celui dont on veut se débarrasser, et
    // `src/proxy.ts` continue de le prendre pour une session.
    readSessionToken.mockResolvedValue(null);

    await logout().catch(() => undefined);

    expect(destroySession).toHaveBeenCalled();
  });

  it("n'écrit aucune trace quand le jeton est illisible", async () => {
    // `audit_logs.actor_id` est une vraie clé étrangère NOT NULL : un cookie
    // corrompu ne désigne personne, il n'y a pas d'acteur à inscrire.
    readSessionToken.mockResolvedValue(null);

    await logout().catch(() => undefined);

    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("trace la déconnexion sur la session, pas sur l'utilisateur", async () => {
    // `entity_type = 'session'` : Constitution §4.2 vise « toute action
    // ADMINISTRATIVE sensible », et une déconnexion n'en est pas une — c'est un
    // évènement de sécurité. ADR-005 écrit déjà cette valeur.
    readSessionToken.mockResolvedValue({ sub: UTILISATEUR, roles: [] });

    await logout().catch(() => undefined);

    expect(writeAuditLog).toHaveBeenCalledWith({
      entityType: "session",
      entityId: UTILISATEUR,
      action: "LOGOUT",
      actorId: UTILISATEUR,
    });
  });

  it("détruit la session AVANT d'écrire la trace", async () => {
    // Un échec d'écriture du journal ne doit pas laisser une session debout.
    // Se déconnecter est l'acte de sécurité, l'auditer n'en est que la mémoire.
    readSessionToken.mockResolvedValue({ sub: UTILISATEUR, roles: [] });

    await logout().catch(() => undefined);

    expect(destroySession.mock.invocationCallOrder[0]).toBeLessThan(
      writeAuditLog.mock.invocationCallOrder[0]!,
    );
  });
});
