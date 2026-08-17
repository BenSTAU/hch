"use server";

import { redirect } from "next/navigation";

import { ENTITE_SESSION, writeAuditLog } from "@/lib/audit/log";
import { AFTER_LOGOUT } from "@/lib/auth/after-login";
import { destroySession, readSessionToken } from "@/lib/auth/session";

/// Server Action de déconnexion. Sans `next-safe-action` : la règle du dépôt
/// vise les actions *avec input* (CLAUDE.md §Server Actions), celle-ci n'en a
/// aucun.
///
/// **La destruction n'est conditionnée à rien.** La subordonner à un jeton
/// valide empêcherait d'effacer un cookie expiré ou signé avec un secret depuis
/// remplacé, celui-là même dont on veut se débarrasser. La lecture ne sert
/// qu'à nommer l'acteur de la trace.
///
/// ⚠️ Ordre imposé : lire, détruire, tracer. Il n'y a plus d'acteur après la
/// destruction, et un échec d'écriture du journal ne doit pas laisser une
/// session debout. Jeton illisible, aucune écriture : `audit_logs.actor_id`
/// est une FK NOT NULL.
///
/// La destination vit dans `src/lib/auth/after-login.ts` : un fichier
/// `"use server"` n'exporte que des fonctions asynchrones.
export async function logout(): Promise<void> {
  const session = await readSessionToken();

  await destroySession();

  if (session) {
    await writeAuditLog({
      entityType: ENTITE_SESSION,
      entityId: session.sub,
      action: "LOGOUT",
      actorId: session.sub,
    });
  }

  // Hors de tout try/catch : `redirect()` fonctionne par throw.
  redirect(AFTER_LOGOUT);
}
