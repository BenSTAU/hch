// @vitest-environment node
//
// Server Action de modification d'un forfait. Même motif que l'ajout : la
// garde compte ici, pas sur l'écran. S'y ajoute le relais du jeton de version,
// dont dépend le refus d'écraser une fiche modifiée entre-temps.
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
vi.mock("@/lib/auth/permissions", () => ({
  requireAdmin: () => requireAdmin(),
}));

const modifierForfait = vi.fn();
vi.mock("@/lib/db/queries/forfaits", () => ({
  modifierForfait: (entree: unknown, actorId: string) =>
    modifierForfait(entree, actorId),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (chemin: string, type?: string) =>
    revalidatePath(chemin, type),
}));

const redirect = vi.fn((cible: string) => {
  throw Object.assign(new Error(`NEXT_REDIRECT;${cible}`), {
    digest: `NEXT_REDIRECT;replace;${cible};307;`,
  });
});
vi.mock("next/navigation", () => ({
  redirect: (cible: string) => redirect(cible),
}));

const { modifierForfaitAction } = await import("./modifier-forfait");

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
  id: 1,
  version: "jeton-de-la-fiche",
  label: "Révision complète",
  description: "Entretien complet",
  duration: "60",
  price: "95",
  isActive: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue(ADMIN);
  modifierForfait.mockResolvedValue({
    ok: true,
    label: "Révision complète",
    changements: ["price"],
  });
});

describe("modifierForfaitAction, garde de rôle", () => {
  it("refuse un appelant sans ROLE_ADMIN avant toute écriture", async () => {
    requireAdmin.mockRejectedValue(forbiddenError());

    await expect(modifierForfaitAction(SAISIE)).rejects.toThrow(
      "NEXT_HTTP_ERROR_FALLBACK;403",
    );
    expect(modifierForfait).not.toHaveBeenCalled();
  });
});

describe("modifierForfaitAction, relais du jeton", () => {
  it("transmet le jeton reçu tel quel au helper métier", async () => {
    // L'action ne l'interprète pas : c'est le helper qui le compare à l'état
    // courant, dans la transaction.
    await modifierForfaitAction(SAISIE).catch(() => undefined);

    expect(modifierForfait).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, version: "jeton-de-la-fiche" }),
      "admin-1",
    );
  });

  it("refuse une soumission sans jeton sans atteindre la base", async () => {
    const resultat = await modifierForfaitAction({ ...SAISIE, version: "" });

    expect(resultat?.validationErrors).toBeDefined();
    expect(modifierForfait).not.toHaveBeenCalled();
  });
});

describe("modifierForfaitAction, refus", () => {
  it("rend le message de la SPEC sur une fiche périmée", async () => {
    modifierForfait.mockResolvedValue({ ok: false, reason: "perime" });

    const resultat = await modifierForfaitAction(SAISIE);

    expect(resultat?.data?.error).toBe(
      "Ce forfait a été modifié entre-temps, rechargez la fiche",
    );
  });

  it("n'invalide ni ne redirige quand rien n'a été écrit", async () => {
    modifierForfait.mockResolvedValue({ ok: false, reason: "perime" });

    await modifierForfaitAction(SAISIE);

    expect(revalidatePath).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("distingue le forfait introuvable du nom déjà pris", async () => {
    modifierForfait.mockResolvedValue({ ok: false, reason: "introuvable" });
    expect((await modifierForfaitAction(SAISIE))?.data?.error).toBe(
      "Forfait introuvable",
    );

    modifierForfait.mockResolvedValue({ ok: false, reason: "nom_pris" });
    expect((await modifierForfaitAction(SAISIE))?.data?.error).toBe(
      "Un forfait actif portant ce nom existe déjà",
    );
  });
});

describe("modifierForfaitAction, succès", () => {
  it("invalide le catalogue puis redirige avec le message", async () => {
    await modifierForfaitAction(SAISIE).catch(() => undefined);

    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(redirect).toHaveBeenCalledWith("/admin/forfaits?modifie=1");
  });

  it("n'invalide RIEN quand rien n'a changé", async () => {
    // Aucune écriture n'a eu lieu : invalider le cache de la vitrine entière
    // pour un formulaire resoumis tel quel serait du travail pour rien.
    modifierForfait.mockResolvedValue({
      ok: true,
      label: "Révision complète",
      changements: [],
    });

    await modifierForfaitAction(SAISIE).catch(() => undefined);

    expect(revalidatePath).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/admin/forfaits?inchange=1");
  });
});
