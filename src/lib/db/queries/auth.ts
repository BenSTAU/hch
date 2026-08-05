import "server-only";

import { db } from "@/lib/db/client";

/// Lecture pour la connexion locale. Charge le provider `local` avec
/// l'utilisateur : sans lui, vérifier le mot de passe demanderait un second
/// aller-retour, et chaque aller-retour se paie dans le tunnel SSH.
///
/// `deletedAt: null` filtre les comptes pseudonymisés : le droit à l'oubli a
/// été exercé, l'identité ne doit plus permettre de se connecter. Le compte
/// désactivé (`isActive = false`), lui, est bien renvoyé — c'est l'appelant
/// qui le refuse, avec le même message que les autres causes.
export async function findUserForLogin(email: string) {
  return db.user.findUnique({
    where: { email, deletedAt: null },
    select: {
      id: true,
      roles: true,
      isActive: true,
      authProviders: {
        where: { provider: "local" },
        select: { provider: true, passwordHash: true },
      },
    },
  });
}

/// Lecture de l'utilisateur courant à partir de l'identifiant porté par la
/// session. Ne remonte que ce que la DAL a le droit d'exposer.
export async function findUserById(id: string) {
  return db.user.findUnique({
    where: { id, deletedAt: null, isActive: true },
    select: {
      id: true,
      email: true,
      firstname: true,
      lastname: true,
      roles: true,
    },
  });
}
