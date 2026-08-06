import "server-only";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db/client";

/// Les quatre actions du dictionnaire §audit_logs, tenues par un CHECK SQL en
/// migration 003. Le dictionnaire les qualifie d'« extensible » : en ajouter
/// une passe par un ALTER de la contrainte, pas par un ALTER TYPE.
export const AUDIT_ACTIONS = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "ANONYMIZE",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditEntry = {
  /// Nom de la TABLE cible — `app_settings`, `users`. Pas du modèle Prisma :
  /// c'est par cette valeur qu'on relira le journal en SQL.
  entityType: string;
  entityId: string;
  action: AuditAction;
  actorId: string;
  details?: Prisma.InputJsonValue;
};

/// Le sous-ensemble du client Prisma dont ce module a besoin, décrit
/// structurellement plutôt que par `PrismaClient` : le client transactionnel
/// passé par `$transaction` n'est pas un `PrismaClient`, et c'est justement
/// lui qu'on veut pouvoir recevoir.
export type AuditWriter = {
  auditLog: {
    create(args: { data: AuditEntry }): unknown;
  };
};

/// Écrit une trace d'action administrative (Constitution §4.2).
///
/// `client` par défaut au client global, mais **toute écriture qui accompagne
/// une mutation doit passer le client transactionnel de cette mutation**. Une
/// trace écrite à côté de sa transaction survit à un rollback, ou manque alors
/// que l'écriture a eu lieu : un journal qui ment est pire qu'un journal
/// absent, c'est la pièce qu'on produit en cas de contestation.
///
/// Aucun `catch` ici, volontairement : un échec d'écriture doit faire échouer
/// la mutation qu'il devait tracer, pas la laisser passer en silence.
export async function writeAuditLog(
  entry: AuditEntry,
  client: AuditWriter = db,
): Promise<void> {
  await client.auditLog.create({
    data: {
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      actorId: entry.actorId,
      details: entry.details,
    },
  });
}
