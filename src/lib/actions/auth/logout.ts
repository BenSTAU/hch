"use server";

import { redirect } from "next/navigation";

import { AFTER_LOGOUT } from "@/lib/auth/after-login";
import { destroySession } from "@/lib/auth/session";

/// Server Action de déconnexion.
///
/// **Sans `next-safe-action`, délibérément** : la règle du dépôt vise les
/// actions *avec input* (CLAUDE.md §Server Actions), et celle-ci n'en a aucun.
/// Lui donner un schéma reviendrait à faire valider par Zod le `FormData` vide
/// que React transmet à `<form action={…}>`, pour un canal d'erreur qui ne
/// serait jamais emprunté.
///
/// **Aucune lecture de session avant destruction** : la rendre conditionnelle à
/// un jeton valide empêcherait d'effacer un cookie expiré ou signé avec un
/// secret depuis remplacé — celui-là même dont on veut se débarrasser, et que
/// `src/proxy.ts` continue de prendre pour une session.
///
/// La destination vit dans `src/lib/auth/after-login.ts` : un fichier
/// `"use server"` n'exporte que des fonctions asynchrones, une constante y fait
/// échouer le build.
export async function logout(): Promise<void> {
  await destroySession();

  // Hors de tout try/catch : `redirect()` fonctionne par throw.
  redirect(AFTER_LOGOUT);
}
