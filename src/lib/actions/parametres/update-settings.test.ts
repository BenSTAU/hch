// @vitest-environment node
//
// Server Action de modification de la configuration société.
//
// C'est le test d'intégration que réclame la DoD de T-J0-05 : *modification
// par un administrateur acceptée, par un non-administrateur refusée*. Il
// s'exerce ici et pas sur la page, parce que c'est ici que la garde compte —
// rappel d'ADR-006 v2 porté par `src/lib/safe-action.ts:5-7` : **une Server
// Action exportée est un endpoint POST public**. Un non-administrateur n'a
// aucun besoin de l'écran pour l'appeler.
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
vi.mock("@/lib/auth/permissions", () => ({ requireAdmin: () => requireAdmin() }));

const updateAppSettings = vi.fn();
vi.mock("@/lib/db/queries/parametres", () => ({
  updateAppSettings: (entries: unknown, actorId: string) =>
    updateAppSettings(entries, actorId),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));

const { updateSettings } = await import("./update-settings");

const ADMIN = {
  id: "admin-1",
  email: "admin@homecyclhome.fr",
  firstname: "Admin",
  lastname: "Principal",
  roles: ["ROLE_ADMIN"],
};

const PAYLOAD = {
  settings: [{ key: "company.name", value: "Le Cycle Lyonnais" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue(ADMIN);
  updateAppSettings.mockResolvedValue({
    ok: true,
    changedKeys: ["company.name"],
  });
});

describe("updateSettings — administrateur", () => {
  it("accepte la modification et rend la main sur les clés changées", async () => {
    const result = await updateSettings(PAYLOAD);

    expect(result?.data).toEqual({ changedKeys: ["company.name"] });
  });

  it("signe l'écriture avec l'identifiant de la SESSION, pas de la charge utile", async () => {
    // `updated_by` ne se soumet pas. S'il venait du POST, n'importe qui
    // pourrait attribuer sa modification à un autre administrateur — et le
    // journal d'audit désignerait un innocent.
    await updateSettings({
      settings: [
        { key: "company.name", value: "X", updatedBy: "victime" },
      ],
    } as unknown as typeof PAYLOAD);

    expect(updateAppSettings).toHaveBeenCalledWith(
      [{ key: "company.name", value: "X" }],
      "admin-1",
    );
  });

  it("revalide la page après écriture", async () => {
    await updateSettings(PAYLOAD);

    expect(revalidatePath).toHaveBeenCalledWith("/admin/parametres");
  });

  it("ne revalide pas quand l'écriture a été refusée", async () => {
    updateAppSettings.mockResolvedValue({
      ok: false,
      reason: "unknown_keys",
      keys: ["company.inexistante"],
    });

    const result = await updateSettings(PAYLOAD);

    expect(revalidatePath).not.toHaveBeenCalled();
    expect(result?.data).toMatchObject({ error: expect.any(String) });
  });
});

describe("updateSettings — non-administrateur", () => {
  it("refuse un client sans jamais atteindre la base", async () => {
    requireAdmin.mockRejectedValue(
      new Error("NEXT_HTTP_ERROR_FALLBACK;403"),
    );

    await expect(updateSettings(PAYLOAD)).rejects.toThrow();
    expect(updateAppSettings).not.toHaveBeenCalled();
  });

  it("garde la garde EN TÊTE d'action, avant toute lecture", async () => {
    // L'ordre est la garde. Une vérification placée après la lecture ou
    // l'écriture protège le résultat affiché, pas la donnée.
    requireAdmin.mockRejectedValue(
      new Error("NEXT_HTTP_ERROR_FALLBACK;403"),
    );

    await updateSettings(PAYLOAD).catch(() => undefined);

    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(updateAppSettings).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("updateSettings — entrées hostiles", () => {
  it("refuse une charge utile vide sans convoquer la garde de rôle", async () => {
    const result = await updateSettings({ settings: [] });

    expect(result?.validationErrors).toBeDefined();
    expect(updateAppSettings).not.toHaveBeenCalled();
  });

  it("refuse une charge utile malformée", async () => {
    const result = await updateSettings({
      settings: [{ key: "company.name" }],
    } as unknown as typeof PAYLOAD);

    expect(result?.validationErrors).toBeDefined();
    expect(updateAppSettings).not.toHaveBeenCalled();
  });

  it("ne réfléchit pas le détail d'une erreur serveur au navigateur", async () => {
    // `handleServerError` de `src/lib/safe-action.ts` : une erreur Prisma non
    // interceptée porte l'hôte, le port et l'utilisateur de la base.
    updateAppSettings.mockRejectedValue(
      new Error("connect ECONNREFUSED hch:motdepasse@localhost:5433"),
    );

    const result = await updateSettings(PAYLOAD);

    expect(JSON.stringify(result)).not.toContain("5433");
    expect(JSON.stringify(result)).not.toContain("motdepasse");
  });
});
