// @vitest-environment node
//
// Journal d'audit. Constitution §4.2 : *toute action administrative sensible
// laisse une trace interrogeable*. PLAN S2 §7 étend explicitement le journal à
// la configuration société — *« en v1, l'historique passe par `audit_logs`
// avec `entity_type='app_settings'` »* — en attendant `app_settings_history`
// en v2.
//
// La table accepte un client transactionnel en second argument : une trace
// écrite hors de la transaction qui la motive peut survivre à un rollback, ou
// manquer alors que l'écriture a eu lieu. Un journal qui ment est pire qu'un
// journal absent — c'est la pièce qu'on produit en cas de contestation.
import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@/lib/db/client", () => ({ db: { auditLog: { create } } }));

const { writeAuditLog } = await import("./log");

const ENTRY = {
  entityType: "app_settings",
  entityId: "company.name",
  action: "UPDATE",
  actorId: "admin-1",
} as const;

beforeEach(() => vi.clearAllMocks());

describe("writeAuditLog", () => {
  it("écrit une ligne avec l'entité, l'acteur et l'action", async () => {
    await writeAuditLog(ENTRY);

    expect(create).toHaveBeenCalledWith({
      data: {
        entityType: "app_settings",
        entityId: "company.name",
        action: "UPDATE",
        actorId: "admin-1",
        details: undefined,
      },
    });
  });

  it("porte le diff avant/après quand il est fourni", async () => {
    // `details` en JSONB, « diff avant/après pour UPDATE »
    // (mcd-dictionnaire §audit_logs).
    await writeAuditLog({
      ...ENTRY,
      details: { before: "LeCycleLyonnais", after: "Le Cycle Lyonnais" },
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          details: { before: "LeCycleLyonnais", after: "Le Cycle Lyonnais" },
        }),
      }),
    );
  });

  it("écrit dans le client transmis plutôt que dans le client global", async () => {
    const txCreate = vi.fn();

    await writeAuditLog(ENTRY, { auditLog: { create: txCreate } });

    expect(txCreate).toHaveBeenCalledOnce();
    expect(create).not.toHaveBeenCalled();
  });

  it("laisse remonter l'échec d'écriture au lieu de l'avaler", async () => {
    // Un `catch {}` silencieux ici produirait exactement le scénario que
    // Constitution §4.2 interdit : une modification appliquée sans trace, et
    // personne pour s'en apercevoir.
    create.mockRejectedValue(new Error("connexion perdue"));

    await expect(writeAuditLog(ENTRY)).rejects.toThrow("connexion perdue");
  });
});
