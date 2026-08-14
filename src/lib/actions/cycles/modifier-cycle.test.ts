// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth/dal", () => ({
  getCurrentUser: () => getCurrentUser(),
}));

const modifierCycleDuClient = vi.fn();
vi.mock("@/lib/db/queries/cycles", () => ({
  modifierCycleDuClient: (args: unknown) => modifierCycleDuClient(args),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (chemin: string) => revalidatePath(chemin),
}));

const { modifierCycle } = await import("./modifier-cycle");

const CLIENT = "3f1e0a5c-0b2d-4c6e-9a11-2b3c4d5e6f70";

const SAISIE = {
  cycleId: 12,
  brand: "Decathlon",
  model: "Elops 900",
  type: "CLASSIC" as const,
  year: 2023,
};

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({
    id: CLIENT,
    email: "client@example.test",
  });
  modifierCycleDuClient.mockResolvedValue({
    ok: true,
    cycle: {
      id: 12,
      brand: "Decathlon",
      model: "Elops 900",
      type: "CLASSIC",
      year: 2023,
    },
  });
});

describe("modifierCycle", () => {
  it("prend le propriétaire dans la SESSION, jamais dans la charge utile", async () => {
    // `cycles.id` est un SERIAL : si le propriétaire venait de l'entrée,
    // modifier le vélo du voisin serait une question d'entier.
    await modifierCycle({ ...SAISIE, userId: "usurpe" } as never);

    expect(modifierCycleDuClient).toHaveBeenCalledWith({
      ...SAISIE,
      userId: CLIENT,
    });
  });

  it("rend « Cycle introuvable. » sur un vélo inconnu comme sur celui d'autrui", async () => {
    // Le helper ne distingue pas les deux cas, et ce message non plus : c'est
    // tout l'objet de l'arbitrage B2 contre le 403 de la SPEC.
    modifierCycleDuClient.mockResolvedValue({
      ok: false,
      reason: "introuvable",
    });

    const resultat = await modifierCycle(SAISIE);

    expect(resultat?.data).toEqual({
      ok: false,
      message: "Cycle introuvable.",
    });
  });

  it("ne revalide rien quand rien n'a été écrit", async () => {
    modifierCycleDuClient.mockResolvedValue({
      ok: false,
      reason: "introuvable",
    });

    await modifierCycle(SAISIE);

    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("invalide la liste ET les deux onglets de l'espace client", async () => {
    // Le vélo est une référence VIVANTE : marque et modèle s'affichent dans le
    // panneau de détail, « Passées » comprise. Sans ces invalidations, ils
    // montreraient l'ancienne valeur.
    await modifierCycle(SAISIE);

    expect(revalidatePath).toHaveBeenCalledWith("/mon-compte/cycles");
    expect(revalidatePath).toHaveBeenCalledWith("/mes-interventions/a-venir");
    expect(revalidatePath).toHaveBeenCalledWith("/mes-interventions/passees");
  });

  it("refuse un identifiant de cycle non positif avant d'atteindre la base", async () => {
    await modifierCycle({ ...SAISIE, cycleId: 0 });

    expect(modifierCycleDuClient).not.toHaveBeenCalled();
  });
});
