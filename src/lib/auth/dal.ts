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

/// Session seule - la charge utile du jeton, sans aller en base.
///
/// `cache()` de React : la portée est la requête en cours, et sans lui un
/// rendu qui vérifie la session dans trois composants serveur relit le cookie
/// et le signe trois fois.
///
/// ⚠️ La vérification réelle se fait dans ce module, **jamais** dans
/// `src/proxy.ts` : leçon structurelle de la CVE-2025-29927, conservée après
/// le correctif.
///
/// ⚠️ **Aucun appelant en production** : `getCurrentUser` passe par
/// `getOptionalUser`. Elle reste exportée parce que CLAUDE.md §Authentication
/// l'impose, et parce qu'elle est la bonne porte pour un appelant qui n'a
/// besoin que du rôle sans le profil.
export const verifySession = cache(async () => {
  const session = await readSessionToken();
  if (!session) redirect("/connexion");
  return session;
});

/// Lecture **non redirigeante** de l'utilisateur courant, `null` quand il n'y a
/// pas de session utilisable. Pour les surfaces publiques qui s'adaptent à une
/// session sans l'exiger : `getCurrentUser` y redirigerait un visiteur anonyme
/// vers `/connexion`, sur une page que la Constitution §5.1 ouvre à tous.
///
/// ⚠️ Ce n'est **pas** une garde : elle n'autorise rien, elle renseigne. Les
/// contrôles d'accès restent dans `permissions.ts`.
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
