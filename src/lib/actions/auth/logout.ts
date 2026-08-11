"use server";

import { redirect } from "next/navigation";

import { ENTITE_SESSION, writeAuditLog } from "@/lib/audit/log";
import { AFTER_LOGOUT } from "@/lib/auth/after-login";
import { destroySession, readSessionToken } from "@/lib/auth/session";

/// Server Action de déconnexion.
///
/// **Sans `next-safe-action`, délibérément** : la règle du dépôt vise les
/// actions *avec input* (CLAUDE.md §Server Actions), et celle-ci n'en a aucun.
/// Lui donner un schéma reviendrait à faire valider par Zod le `FormData` vide
/// que React transmet à `<form action={…}>`, pour un canal d'erreur qui ne
/// serait jamais emprunté.
///
/// **La destruction n'est conditionnée à rien** : la subordonner à un jeton
/// valide empêcherait d'effacer un cookie expiré ou signé avec un secret depuis
/// remplacé — celui-là même dont on veut se débarrasser, et que `src/proxy.ts`
/// continue de prendre pour une session. La lecture ajoutée par T-V3-10 ne sert
/// **qu'à** nommer l'acteur de la trace, elle ne décide de rien.
///
/// Ordre : lire, détruire, tracer. La lecture doit précéder la destruction, il
/// n'y a plus d'acteur après. La trace doit la suivre, parce qu'un échec
/// d'écriture du journal ne doit pas laisser une session debout — se déconnecter
/// est l'acte de sécurité, l'auditer n'en est que la mémoire.
///
/// Jeton illisible : **aucune écriture**. `audit_logs.actor_id` est une vraie FK
/// NOT NULL, et un cookie corrompu ne désigne personne. Arbitré le 2026-08-11.
///
/// La destination vit dans `src/lib/auth/after-login.ts` : un fichier
/// `"use server"` n'exporte que des fonctions asynchrones, une constante y fait
/// échouer le build.
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
