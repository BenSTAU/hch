// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth/dal", () => ({
  getCurrentUser: () => getCurrentUser(),
}));

const rattacherCycleAIntervention = vi.fn();
vi.mock("@/lib/db/queries/cycles", () => ({
  rattacherCycleAIntervention: (args: unknown) =>
    rattacherCycleAIntervention(args),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (chemin: string) => revalidatePath(chemin),
}));

const { rattacherCycle } = await import("./rattacher-cycle");

const CLIENT = "3f1e0a5c-0b2d-4c6e-9a11-2b3c4d5e6f70";

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({
    id: CLIENT,
    email: "client@example.test",
  });
  rattacherCycleAIntervention.mockResolvedValue({ ok: true });
});

describe("rattacherCycle", () => {
  it("prend le propriétaire dans la SESSION, jamais dans la charge utile", async () => {
    // Les deux identifiants sont des SERIAL. C'est cette ligne qui empêche de
    // rattacher son vélo au rendez-vous d'un tiers en incrémentant un entier.
    await rattacherCycle({
      interventionId: 3,
      cycleId: 12,
      clientId: "usurpe",
    } as never);

    expect(rattacherCycleAIntervention).toHaveBeenCalledWith({
      interventionId: 3,
      cycleId: 12,
      clientId: CLIENT,
    });
  });

  it("transporte le détachement tel quel", async () => {
    await rattacherCycle({ interventionId: 3, cycleId: null });

    expect(rattacherCycleAIntervention).toHaveBeenCalledWith(
      expect.objectContaining({ cycleId: null }),
    );
  });

  it("invalide l'onglet à venir, seul porteur des interventions PLANNED", async () => {
    await rattacherCycle({ interventionId: 3, cycleId: 12 });

    expect(revalidatePath).toHaveBeenCalledWith("/mes-interventions/a-venir");
  });

  it("rend « Intervention introuvable. » sur une intervention absente ou d'autrui", async () => {
    rattacherCycleAIntervention.mockResolvedValue({
      ok: false,
      reason: "introuvable",
    });

    const resultat = await rattacherCycle({ interventionId: 3, cycleId: 12 });

    expect(resultat?.data).toEqual({
      ok: false,
      message: "Intervention introuvable.",
    });
  });

  it("rend « Cycle introuvable. » sur le vélo d'un tiers", async () => {
    // Le même libellé que la modification, et pour la même raison : deux refus
    // distincts diraient au curieux lequel de ses deux entiers a touché.
    rattacherCycleAIntervention.mockResolvedValue({
      ok: false,
      reason: "cycle_introuvable",
    });

    const resultat = await rattacherCycle({ interventionId: 3, cycleId: 999 });

    expect(resultat?.data).toEqual({
      ok: false,
      message: "Cycle introuvable.",
    });
  });

  it("dit la frontière de statut plutôt qu'« introuvable » sur une intervention verrouillée", async () => {
    // Ici, l'existence n'est pas un secret : le client la voit dans sa liste.
    // Le refus doit lui dire POURQUOI il ne peut plus changer de vélo.
    rattacherCycleAIntervention.mockResolvedValue({
      ok: false,
      reason: "verrouillee",
    });

    const resultat = await rattacherCycle({ interventionId: 3, cycleId: 12 });

    expect(resultat?.data?.ok).toBe(false);
    expect(resultat?.data?.message).toContain("démarrée, terminée ou annulée");
  });

  it("ne revalide rien quand rien n'a été écrit", async () => {
    rattacherCycleAIntervention.mockResolvedValue({
      ok: false,
      reason: "verrouillee",
    });

    await rattacherCycle({ interventionId: 3, cycleId: 12 });

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
