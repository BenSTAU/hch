// @vitest-environment node
//
// Helper métier de la configuration société. CLAUDE.md §Server Actions impose
// de le séparer de la Server Action : pas de `revalidatePath`, pas de
// `redirect`, pas de contexte Next — donc testable ici, en isolation.
//
// Ce qu'il porte et qui ne peut pas vivre ailleurs : le **diff**. Écrire les
// cinq champs du formulaire à chaque soumission produirait cinq entrées
// d'audit dont quatre décriraient un changement qui n'a pas eu lieu, et
// tamponnerait `updated_by` sur des lignes que personne n'a touchées.
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const update = vi.fn();
const tx = { appSetting: { findMany, update } };

vi.mock("@/lib/db/client", () => ({
  db: {
    appSetting: { findMany },
    $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
  },
}));

const writeAuditLog = vi.fn();
vi.mock("@/lib/audit/log", () => ({
  writeAuditLog: (entry: unknown, client: unknown) =>
    writeAuditLog(entry, client),
}));

const { listAppSettings, updateAppSettings } = await import("./parametres");

const CURRENT = [
  {
    key: "company.name",
    value: "LeCycleLyonnais",
    valueType: "string",
    description: "Raison sociale",
    updatedAt: new Date("2026-08-05T10:00:00Z"),
  },
  {
    key: "company.email",
    value: "contact@homecyclhome.fr",
    valueType: "string",
    description: "Adresse de contact publique",
    updatedAt: new Date("2026-08-05T10:00:00Z"),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue(CURRENT);
});

describe("listAppSettings", () => {
  it("renvoie les paramètres triés par clé", async () => {
    // Ordre stable : la page est un formulaire, et des champs qui changent de
    // place d'un rendu à l'autre sont un défaut d'utilisabilité autant qu'un
    // test E2E instable.
    await listAppSettings();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { key: "asc" } }),
    );
  });
});

describe("updateAppSettings — cas nominal", () => {
  it("écrit la valeur modifiée et signe la ligne", async () => {
    const result = await updateAppSettings(
      [{ key: "company.name", value: "Le Cycle Lyonnais" }],
      "admin-1",
    );

    expect(result).toEqual({ ok: true, changedKeys: ["company.name"] });
    expect(update).toHaveBeenCalledWith({
      where: { key: "company.name" },
      data: { value: "Le Cycle Lyonnais", updatedBy: "admin-1" },
    });
  });

  it("écrit une entrée d'audit portant le diff", async () => {
    await updateAppSettings(
      [{ key: "company.name", value: "Le Cycle Lyonnais" }],
      "admin-1",
    );

    expect(writeAuditLog).toHaveBeenCalledWith(
      {
        entityType: "app_settings",
        entityId: "company.name",
        action: "UPDATE",
        actorId: "admin-1",
        details: { before: "LeCycleLyonnais", after: "Le Cycle Lyonnais" },
      },
      tx,
    );
  });

  it("n'écrit pas les valeurs inchangées", async () => {
    const result = await updateAppSettings(
      [
        { key: "company.name", value: "LeCycleLyonnais" },
        { key: "company.email", value: "nouveau@homecyclhome.fr" },
      ],
      "admin-1",
    );

    expect(result).toEqual({ ok: true, changedKeys: ["company.email"] });
    expect(update).toHaveBeenCalledOnce();
    expect(writeAuditLog).toHaveBeenCalledOnce();
  });

  it("ne touche à rien quand rien n'a changé", async () => {
    const result = await updateAppSettings(
      [{ key: "company.name", value: "LeCycleLyonnais" }],
      "admin-1",
    );

    expect(result).toEqual({ ok: true, changedKeys: [] });
    expect(update).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("audite dans la transaction, pas à côté", async () => {
    // Si la trace était écrite avec le client global, un rollback de la
    // transaction laisserait une entrée d'audit décrivant une modification
    // qui n'a jamais été committée.
    await updateAppSettings(
      [{ key: "company.name", value: "Autre" }],
      "admin-1",
    );

    expect(writeAuditLog).toHaveBeenCalledWith(expect.anything(), tx);
  });
});

describe("updateAppSettings — refus", () => {
  it("refuse une clé absente de la base sans rien écrire", async () => {
    // La table est clé-valeur et le formulaire est piloté par ses lignes :
    // une clé inconnue vient forcément d'ailleurs que de l'écran. `upsert`
    // ici laisserait n'importe qui peupler la configuration société.
    const result = await updateAppSettings(
      [{ key: "company.inexistante", value: "x" }],
      "admin-1",
    );

    expect(result).toEqual({
      ok: false,
      reason: "unknown_keys",
      keys: ["company.inexistante"],
    });
    expect(update).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuse une valeur incompatible avec son `value_type`", async () => {
    findMany.mockResolvedValue([
      {
        key: "company.tva",
        value: "20",
        valueType: "number",
        description: "Taux de TVA",
        updatedAt: new Date(),
      },
    ]);

    const result = await updateAppSettings(
      [{ key: "company.tva", value: "vingt" }],
      "admin-1",
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalid_values",
      keys: ["company.tva"],
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuse le lot entier plutôt que d'en écrire la moitié", async () => {
    // Tout ou rien : une soumission partiellement appliquée laisse l'écran et
    // la base en désaccord, et l'administrateur ne sait pas ce qui est passé.
    const result = await updateAppSettings(
      [
        { key: "company.name", value: "Le Cycle Lyonnais" },
        { key: "company.inexistante", value: "x" },
      ],
      "admin-1",
    );

    expect(result.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
