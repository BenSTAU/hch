import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { findUserById } from "@/lib/db/queries/auth";

import { readSessionToken } from "./session";

export type CurrentUser = {
  id: string;
  email: string;
  firstname: string;
  lastname: string;
  roles: string[];
};

/// `cache()` de React, pas de mémoïsation maison : la portée est la requête en
/// cours. Sans lui, un rendu qui vérifie la session dans trois composants
/// serveur relit le cookie et le signe trois fois.
///
/// C'est ICI que se fait la vérification réelle, jamais dans `src/proxy.ts` —
/// leçon structurelle de la CVE-2025-29927, conservée après le correctif.
export const verifySession = cache(async () => {
  const session = await readSessionToken();
  if (!session) redirect("/connexion");
  return session;
});

/// Lecture **non redirigeante** de l'utilisateur courant — `null` quand il n'y
/// a pas de session utilisable.
///
/// Elle existe pour les surfaces publiques qui s'adaptent à la présence d'une
/// session sans l'exiger : l'accueil, qui porte l'en-tête de l'espace connecté
/// depuis T-V3-03. `getCurrentUser` y redirigerait vers `/connexion` un
/// visiteur anonyme, sur une page dont la Constitution §5.1 fait justement une
/// page ouverte à tous.
///
/// Ce n'est **pas** une garde : elle n'autorise rien, elle renseigne. Les
/// contrôles d'accès restent dans `permissions.ts`, appelés par chaque page.
export const getOptionalUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await readSessionToken();
  if (!session) return null;

  // La session peut survivre à l'utilisateur qu'elle désigne : compte
  // désactivé, pseudonymisé, ou supprimé depuis l'émission du jeton. Un JWT
  // valide ne prouve pas que le compte l'est encore.
  const user = await findUserById(session.sub);
  if (!user) return null;

  // Projection explicite, et non un simple passe-plat de la requête. Le
  // `select` de `findUserById` fait déjà le tri, mais s'y fier seul rendrait
  // toute future extension de ce select silencieusement fuyante. Le DTO est
  // décidé ici, à la frontière, pas dans la couche d'accès.
  return {
    id: user.id,
    email: user.email,
    firstname: user.firstname,
    lastname: user.lastname,
    roles: user.roles,
  };
});

/// Renvoie un DTO, jamais l'entité Prisma : le téléphone, `deletedAt` et les
/// horodatages n'ont aucune raison de traverser la frontière serveur/client
/// (CLAUDE.md §Authentication).
export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  const user = await getOptionalUser();
  if (!user) redirect("/connexion");
  return user;
});
