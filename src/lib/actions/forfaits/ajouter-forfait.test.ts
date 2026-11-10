// @vitest-environment node
//
// Server Action d'ajout d'un forfait. Elle s'exerce ici et pas sur l'écran,
// parce que c'est ici que la garde compte : une Server Action exportée est un
// endpoint POST public (ADR-006 v2), et un non-administrateur n'a aucun besoin
// du formulaire pour l'appeler.
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
vi.mock("@/lib/auth/permissions", () => ({
  requireAdmin: () => requireAdmin(),
}));

const creerForfait = vi.fn();
vi.mock("@/lib/db/queries/forfaits", () => ({
  creerForfait: (champs: unknown, actorId: string) =>
    creerForfait(champs, actorId),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (chemin: string, type?: string) =>
    revalidatePath(chemin, type),
}));

const redirect = vi.fn((cible: string) => {
  // `redirect()` de Next interrompt par un throw : le simuler en fonction
  // vide laisserait le reste du corps s'exécuter, ce qu'il ne fait jamais en
  // vrai.
  throw Object.assign(new Error(`NEXT_REDIRECT;${cible}`), {
    digest: `NEXT_REDIRECT;replace;${cible};307;`,
  });
});
vi.mock("next/navigation", () => ({
  redirect: (cible: string) => redirect(cible),
}));

const { ajouterForfait } = await import("./ajouter-forfait");

/// Reproduit l'erreur que lève réellement `forbidden()` de Next :
/// next-safe-action ne reconnaît une erreur de framework que par sa propriété
/// `digest`, et ne la relance que dans ce cas.
function forbiddenError(): Error {
  const error = new Error("NEXT_HTTP_ERROR_FALLBACK;403");
  Object.assign(error, { digest: "NEXT_HTTP_ERROR_FALLBACK;403" });
  return error;
}

const ADMIN = {
  id: "admin-1",
  email: "admin@homecyclhome.fr",
  firstname: "Admin",
  lastname: "Principal",
  roles: ["ROLE_ADMIN"],
};

const SAISIE = {
  label: "Révision complète",
  description: "Entretien complet",
  duration: "60",
  price: "85",
  isActive: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue(ADMIN);
  creerForfait.mockResolvedValue({
    ok: true,
    id: 7,
    label: "Révision complète",
  });
});

describe("ajouterForfait, garde de rôle", () => {
  it("refuse un appelant sans ROLE_ADMIN avant toute écriture", async () => {
    requireAdmin.mockRejectedValue(forbiddenError());

    await expect(ajouterForfait(SAISIE)).rejects.toThrow(
      "NEXT_HTTP_ERROR_FALLBACK;403",
    );
    expect(creerForfait).not.toHaveBeenCalled();
  });

  it("refuse avant même la validation du schéma", async () => {
    // La garde vit en middleware, donc avant Zod : un appelant anonyme ne doit
    // pas pouvoir sonder la forme du schéma en envoyant n'importe quoi.
    requireAdmin.mockRejectedValue(forbiddenError());

    await expect(
      ajouterForfait({} as unknown as typeof SAISIE),
    ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;403");
    expect(creerForfait).not.toHaveBeenCalled();
  });
});

describe("ajouterForfait, cas nominal", () => {
  it("écrit avec l'administrateur du contexte, jamais celui de la charge utile", async () => {
    await ajouterForfait({
      ...SAISIE,
      actorId: "usurpateur",
    } as unknown as typeof SAISIE).catch(() => undefined);

    expect(creerForfait).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Révision complète" }),
      "admin-1",
    );
  });

  it("transmet les valeurs normalisées par le schéma", async () => {
    await ajouterForfait(SAISIE).catch(() => undefined);

    expect(creerForfait).toHaveBeenCalledWith(
      {
        label: "Révision complète",
        description: "Entretien complet",
        duration: 60,
        price: "85.00",
        isActive: true,
      },
      "admin-1",
    );
  });

  it("invalide le catalogue puis redirige vers la liste avec le message", async () => {
    await ajouterForfait(SAISIE).catch(() => undefined);

    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(redirect).toHaveBeenCalledWith(
      // L'identifiant, pas le libellé : un nom transporté en clair permettrait
      // de forger une confirmation pour un forfait inexistant (constat B2 de
      // l'agent testeur).
      "/admin/forfaits?ajoute=7",
    );
  });
});

describe("ajouterForfait, refus", () => {
  it("rend le message de la SPEC sur un nom déjà pris", async () => {
    creerForfait.mockResolvedValue({ ok: false, reason: "nom_pris" });

    const resultat = await ajouterForfait(SAISIE);

    expect(resultat?.data?.error).toBe(
      "Un forfait actif portant ce nom existe déjà",
    );
  });

  it("n'invalide ni ne redirige quand rien n'a été écrit", async () => {
    creerForfait.mockResolvedValue({ ok: false, reason: "nom_pris" });

    await ajouterForfait(SAISIE);

    expect(revalidatePath).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("refuse une saisie invalide sans atteindre la base", async () => {
    const resultat = await ajouterForfait({ ...SAISIE, price: "0" });

    expect(resultat?.validationErrors).toBeDefined();
    expect(creerForfait).not.toHaveBeenCalled();
  });
});
