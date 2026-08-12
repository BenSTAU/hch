// @vitest-environment node
//
// La suppression de compte - `US-COMPTE-SUPPRIMER`. Les gardes vivent dans le
// helper métier et y sont testées ; ce fichier éprouve l'orchestration, qui
// porte quatre propriétés qu'aucune autre surface ne couvre :
//
//   · le titulaire vient de la SESSION, jamais de la charge utile ;
//   · la session est détruite AVANT la redirection, sinon l'écran suivant
//     s'affiche encore connecté ;
//   · l'invalidation porte sur le layout entier, le compte disparaissant de
//     l'en-tête autant que des listes ;
//   · un refus ne détruit rien et n'invalide rien.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth/dal", () => ({
  getCurrentUser: () => getCurrentUser(),
}));

const pseudonymiserCompte = vi.fn();
vi.mock("@/lib/db/queries/users", () => ({
  pseudonymiserCompte: (args: unknown) => pseudonymiserCompte(args),
}));

const destroySession = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  destroySession: () => destroySession(),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (chemin: string, type?: string) =>
    revalidatePath(chemin, type),
}));

// `redirect` de Next fonctionne par throw, et c'est ce qui est reproduit ici :
// un double qui rendrait une valeur laisserait passer du code écrit après lui.
//
// Le `digest` n'est pas décoratif, et il a fait rougir ce test avant de le
// faire passer : c'est à lui que `next-safe-action` reconnaît une redirection
// pour la re-lever. Sans lui, la bibliothèque prend le throw pour une panne et
// rend un `serverError` générique - le client resterait connecté sur un compte
// effacé, en lisant « une erreur est survenue ». Même double que
// `logout.test.ts` et `login.test.ts`.
const redirect = vi.fn((chemin: string) => {
  throw Object.assign(new Error("NEXT_REDIRECT"), {
    digest: `NEXT_REDIRECT;push;${chemin};307;`,
  });
});
vi.mock("next/navigation", () => ({
  redirect: (chemin: string) => redirect(chemin),
}));

const { supprimerCompte } = await import("./supprimer-compte");
const { CHEMIN_COMPTE_SUPPRIME } = await import("@/lib/routes");

const CLIENT = "8c7d6e5f-4a3b-4291-8180-7f6e5d4c3b2a";

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({
    id: CLIENT,
    email: "camille@exemple.fr",
    firstname: "Camille",
    lastname: "Roux",
    roles: ["ROLE_CLIENT"],
  });
  pseudonymiserCompte.mockResolvedValue({ ok: true });
  destroySession.mockResolvedValue(undefined);
});

describe("supprimerCompte", () => {
  it("passe l'identifiant de la session, jamais celui de la charge utile", async () => {
    // Rappel d'ADR-006 v2 : cette action est un endpoint POST public. Le schéma
    // ne porte aucun identifiant, et c'est la raison pour laquelle le 403 de
    // l'US §Cas d'erreur ne peut pas se produire - il n'y a rien à falsifier.
    await supprimerCompte({ motDePasse: "secret" }).catch(() => undefined);

    expect(pseudonymiserCompte).toHaveBeenCalledWith(
      expect.objectContaining({ userId: CLIENT, motDePasse: "secret" }),
    );
  });

  it("fixe l'instant une seule fois et le transmet au helper", async () => {
    await supprimerCompte({ motDePasse: "secret" }).catch(() => undefined);

    const [args] = pseudonymiserCompte.mock.calls[0] as [{ maintenant: Date }];
    expect(args.maintenant).toBeInstanceOf(Date);
  });

  it("détruit la session puis redirige vers l'accueil avec le message final", async () => {
    // La redirection **traverse** `next-safe-action` au lieu d'être avalée en
    // `serverError` : c'est la propriété que cette assertion tient, et elle
    // n'est vraie que parce que le double porte le `digest` de Next.
    await expect(supprimerCompte({ motDePasse: "secret" })).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(destroySession).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith(CHEMIN_COMPTE_SUPPRIME);
    // L'ordre est la propriété, pas la présence : rediriger avant de détruire
    // le cookie afficherait l'accueil en session ouverte sur un compte qui
    // n'existe plus.
    expect(destroySession.mock.invocationCallOrder[0]).toBeLessThan(
      redirect.mock.invocationCallOrder[0] as number,
    );
  });

  it("invalide le layout entier et non la seule page d'accueil", async () => {
    await supprimerCompte({ motDePasse: "secret" }).catch(() => undefined);

    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("rend le libellé de l'US quand le mot de passe est faux, sans rien détruire", async () => {
    pseudonymiserCompte.mockResolvedValue({
      ok: false,
      reason: "mot_de_passe_invalide",
    });

    const resultat = await supprimerCompte({ motDePasse: "faux" });

    expect(resultat?.data).toEqual({
      ok: false,
      message: "Mot de passe incorrect",
    });
    expect(destroySession).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    // Rien n'a changé en base : revalider ferait recharger l'écran qui porte le
    // message, et le message partirait avec lui.
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rend le libellé de l'US au dernier administrateur", async () => {
    pseudonymiserCompte.mockResolvedValue({
      ok: false,
      reason: "dernier_admin",
    });

    const resultat = await supprimerCompte({ motDePasse: "secret" });

    expect(resultat?.data?.message).toBe(
      "Vous êtes le dernier administrateur - désignez un remplaçant avant de supprimer votre compte",
    );
    expect(destroySession).not.toHaveBeenCalled();
  });

  it("oriente vers le contact un compte sans mot de passe local", async () => {
    pseudonymiserCompte.mockResolvedValue({
      ok: false,
      reason: "sans_mot_de_passe",
    });

    const resultat = await supprimerCompte({ motDePasse: "peu importe" });

    // Le message doit dire QUOI FAIRE : un compte Google pur ne peut pas
    // confirmer par mot de passe, et l'US ne connaît pas d'autre facteur. Le
    // second facteur est reporté sur la DoD de T-V3-04, qui livre l'OAuth.
    expect(resultat?.data?.message).toMatch(/Google/);
    expect(resultat?.data?.message).toMatch(/Contactez-nous/);
    expect(destroySession).not.toHaveBeenCalled();
  });

  it("refuse l'appelant sans session AVANT toute lecture du schéma", async () => {
    // ⚠️ Ajout de l'agent testeur, 2026-08-12. Même trou que sur
    // `annuler-intervention` en T-V3-11 : le double de `getCurrentUser` rendait
    // toujours un utilisateur, donc rien n'éprouvait la garde d'une action qui
    // efface un compte.
    //
    // `src/proxy.ts` ne protège rien ici - il laisse même explicitement passer
    // les requêtes portant l'en-tête `Next-Action` (src/proxy.ts:41-43). Le
    // seul rempart de cette action est le middleware d'`authActionClient`.
    //
    // La charge utile est volontairement invalide : ce que le test affirme est
    // l'ORDRE promis par `safe-action.ts` - middleware, PUIS Zod, PUIS corps.
    // Un anonyme ne doit apprendre ni la forme du schéma ni l'existence du
    // compte visé.
    getCurrentUser.mockRejectedValue(new Error("NEXT_REDIRECT"));

    const resultat = await supprimerCompte({ motDePasse: "" }).catch(
      () => undefined,
    );

    expect(pseudonymiserCompte).not.toHaveBeenCalled();
    expect(destroySession).not.toHaveBeenCalled();
    expect(resultat?.validationErrors).toBeUndefined();
  });

  it("refuse un mot de passe vide avant d'atteindre le helper", async () => {
    const resultat = await supprimerCompte({ motDePasse: "" });

    expect(resultat?.validationErrors).toBeDefined();
    expect(pseudonymiserCompte).not.toHaveBeenCalled();
  });

  it("refuse un mot de passe démesuré avant d'atteindre bcrypt", async () => {
    // bcrypt hache tout ce qu'on lui donne alors qu'il ne lit que 72 octets :
    // sans cette borne, un appelant offre au serveur un hachage arbitrairement
    // coûteux sur un endpoint POST public.
    const resultat = await supprimerCompte({ motDePasse: "a".repeat(201) });

    expect(resultat?.validationErrors).toBeDefined();
    expect(pseudonymiserCompte).not.toHaveBeenCalled();
  });
});
