import "server-only";

import { normalizeEmail } from "@/lib/auth/email";
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

/// Valeur exigée par le CHECK SQL de la migration 001 — le dictionnaire
/// §verification_tokens fixe l'énumération à `email_verification | password_reset`.
/// Une faute de frappe ne se verrait qu'à l'insertion.
export const EMAIL_VERIFICATION_PURPOSE = "email_verification";

export type SignupAccountState = {
  id: string;
  firstname: string;
  isActive: boolean;
  /// L'email a déjà été vérifié — `users.email_verified_at` non NULL.
  ///
  /// C'est le discriminant du renvoi, et `isActive` ne peut pas le porter : le
  /// dictionnaire a consolidé `is_activated` DANS `is_active` en v2
  /// (mcd-dictionnaire.md:89 et :484), si bien qu'un compte désactivé par un
  /// administrateur et un compte jamais activé sont le même état sur cette
  /// colonne. Un renvoi qui s'y fierait réactiverait un compte que l'admin a
  /// fermé.
  ///
  /// L'historique de `verification_tokens` ne peut pas non plus servir : le
  /// dictionnaire écrit que la table « ne s'applique pas aux comptes 100% OAuth
  /// Google » (:182), et les trois comptes du seed n'ont aucun jeton. D'où la
  /// colonne dédiée, arbitrée le 2026-08-08 (agent testeur T-V3-02, B1).
  hasCompletedEmailVerification: boolean;
};

/// Lecture préalable à l'inscription.
///
/// `deletedAt` n'est PAS filtré ici, à la différence de `findUserForLogin` :
/// l'index unique sur `users.email` ne connaît pas cette nuance, et masquer une
/// ligne existante ferait échouer l'insertion sur une contrainte — donc en 500,
/// au lieu du message générique attendu.
export async function findAccountForSignup(
  email: string,
): Promise<SignupAccountState | null> {
  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      // Le prénom ENREGISTRÉ, pas celui du formulaire : le renvoi part vers une
      // adresse dont l'auteur de la soumission n'est pas forcément le titulaire.
      firstname: true,
      isActive: true,
      emailVerifiedAt: true,
    },
  });

  if (!user) return null;

  return {
    id: user.id,
    firstname: user.firstname,
    isActive: user.isActive,
    hasCompletedEmailVerification: user.emailVerifiedAt !== null,
  };
}

/// Crée le compte, son provider local et son premier jeton d'activation — les
/// trois dans la MÊME transaction.
///
/// Sans atomicité, un échec après `users` laisse un compte sans mot de passe et
/// sans jeton : l'email est pris, l'inscription échoue à jamais pour cette
/// personne, et le message générique lui dira que tout va bien.
///
/// **Lève P2002** quand l'email a été pris entre la lecture et l'insertion. La
/// lecture qui précède l'appel n'est PAS dans cette transaction, et ne peut pas
/// l'être sans sérialiser toutes les inscriptions : deux soumissions concurrentes
/// du même email libre passent donc toutes les deux le contrôle, et la seconde
/// heurte l'index unique. C'est l'index qui arbitre.
///
/// Ce module laisse remonter, et n'en décide rien : quelle réponse produire pour
/// le perdant est une décision de parcours, pas de persistance. Elle vit dans
/// `src/lib/actions/auth/signup.ts` (agent testeur T-V3-02, B5).
export async function createLocalAccount(input: {
  email: string;
  firstname: string;
  lastname: string;
  passwordHash: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<{ userId: string }> {
  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        // Normalisé ICI, et pas seulement dans le schéma Zod de l'appelant :
        // l'index unique de Postgres compare octet par octet, et une écriture
        // qui échapperait au schéma créerait un doublon invisible. Le CHECK
        // SQL `email = lower(email)` est le second filet.
        email: normalizeEmail(input.email),
        firstname: input.firstname,
        lastname: input.lastname,
        roles: ["ROLE_CLIENT"],
        // La colonne a `DEFAULT true` : l'omettre créerait un compte utilisable
        // sans avoir vérifié l'email (US-COMPTE-CREER §Cas nominal).
        isActive: false,
      },
      select: { id: true },
    });

    await tx.authProvider.create({
      data: {
        userId: user.id,
        provider: "local",
        passwordHash: input.passwordHash,
      },
    });

    await tx.verificationToken.create({
      data: {
        userId: user.id,
        tokenHash: input.tokenHash,
        purpose: EMAIL_VERIFICATION_PURPOSE,
        expiresAt: input.expiresAt,
      },
    });

    return { userId: user.id };
  });
}

/// Remplace le jeton d'activation en attente — `US-COMPTE-ACTIVER` §Renvoi :
/// « un nouveau token est généré (précédent invalidé) ». Laisser vivre l'ancien
/// donnerait deux liens valides pour un compte, donc deux fenêtres au lieu d'une.
///
/// `usedAt: null` dans le filtre de suppression : les jetons DÉJÀ consommés sont
/// la trace de l'activation, et le discriminant du renvoi. Les effacer rendrait
/// un compte activé indéfiniment éligible au renvoi.
export async function replacePendingEmailVerificationToken(input: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.verificationToken.deleteMany({
      where: {
        userId: input.userId,
        purpose: EMAIL_VERIFICATION_PURPOSE,
        usedAt: null,
      },
    });

    await tx.verificationToken.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        purpose: EMAIL_VERIFICATION_PURPOSE,
        expiresAt: input.expiresAt,
      },
    });
  });
}

/// Recherche par **hash**, jamais par jeton clair : le clair ne vit que dans
/// l'URL de l'email (dictionnaire §verification_tokens).
///
/// Un jeton d'un autre usage est traité comme inexistant. Un `password_reset` ne
/// doit pas activer un compte : les deux TTL diffèrent (1 h contre 24 h) et les
/// deux parcours n'ont pas le même niveau de preuve.
export async function findEmailVerificationToken(tokenHash: string): Promise<{
  id: string;
  userId: string;
  expiresAt: Date;
  usedAt: Date | null;
} | null> {
  const token = await db.verificationToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      purpose: true,
      expiresAt: true,
      usedAt: true,
    },
  });

  if (!token || token.purpose !== EMAIL_VERIFICATION_PURPOSE) return null;

  return {
    id: token.id,
    userId: token.userId,
    expiresAt: token.expiresAt,
    usedAt: token.usedAt,
  };
}

/// Consomme le jeton et active le compte, dans la même transaction.
///
/// Un jeton consommé sans activation laisse un compte inactivable : le lien ne
/// marche plus, et le renvoi non plus puisqu'un jeton consommé existe désormais.
///
/// `usedAt: null` dans le `where` de l'update est l'anti-rejeu au niveau de la
/// BASE, et pas seulement du contrôle applicatif qui précède. Deux clics
/// simultanés sur le même lien passent tous les deux la lecture ; c'est cette
/// clause qui fait perdre le second, en levant P2025 et en annulant la
/// transaction.
///
/// Le second `where` porte la même logique côté compte : `emailVerifiedAt: null`
/// interdit à un jeton émis AVANT une désactivation administrative de rouvrir le
/// compte, et `deletedAt: null` à un lien de ressusciter une identité
/// pseudonymisée. Sans eux, l'update passerait sur n'importe quel état.
///
/// **Lève P2025** quand rien n'a matché — course perdue, ou compte devenu
/// inéligible. Comme pour `createLocalAccount`, ce module ne décide pas du
/// message : c'est `src/lib/actions/auth/activate.ts` qui en fait « compte déjà
/// activé », le libellé que la SPEC prévoit pour un jeton consommé.
export async function activateAccountWithToken(input: {
  tokenId: string;
  userId: string;
  now: Date;
}): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.verificationToken.update({
      where: { id: input.tokenId, usedAt: null },
      data: { usedAt: input.now },
    });

    await tx.user.update({
      where: { id: input.userId, emailVerifiedAt: null, deletedAt: null },
      data: { isActive: true, emailVerifiedAt: input.now },
    });
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
