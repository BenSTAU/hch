import "server-only";

import { writeAuditLog } from "@/lib/audit/log";
import { verifyPassword } from "@/lib/auth/password";
import { db } from "@/lib/db/client";
import { isPrismaError, PRISMA_RECORD_NOT_FOUND } from "@/lib/db/prisma-error";
import { activationRateLimitKey, loginRateLimitKey } from "@/lib/rate-limit";

/// Valeurs de pseudonymisation, fixées par PLAN S2 §T6.
///
/// **Pseudonymisation, pas anonymisation** : les clés étrangères vers
/// `interventions` et `payments` restent intactes pour l'obligation comptable,
/// donc la personne reste ré-identifiable par croisement et le RGPD continue de
/// s'appliquer. C'est ce qui interdit d'écrire « vos données disparaissent »
/// dans l'interface (PLAN S4 §4.4).
export const PRENOM_PSEUDONYME = "Utilisateur";
export const NOM_PSEUDONYME = "Anonymisé";
export const RUE_PSEUDONYME = "Anonymisée";
/// `cycles.brand` est NOT NULL : la marque est remplacée, le modèle et l'année
/// tombent à NULL. PLAN S2 §T6 ne couvre que `users`.
export const MARQUE_PSEUDONYME = "Anonymisé";

/// `deleted-<uuid>@anon.local` - `US-COMPTE-SUPPRIMER` §Cas nominal. Le domaine
/// `anon.local` n'existe pas, et c'est voulu : l'adresse doit rester unique,
/// l'index de `users.email` ne connaissant pas la pseudonymisation, sans jamais
/// être joignable.
export function emailPseudonyme(userId: string): string {
  return `deleted-${userId}@anon.local`;
}

export type ResultatSuppressionCompte =
  | { ok: true }
  | { ok: false; reason: "mot_de_passe_invalide" }
  | { ok: false; reason: "sans_mot_de_passe" }
  | { ok: false; reason: "dernier_admin" };

/// Droit à l'oubli - `US-COMPTE-SUPPRIMER`, pseudonymisation in-place.
///
/// Le mot de passe se vérifie **hors** de la transaction : `bcrypt.compare`
/// coûte une centaine de millisecondes, et les tenir avec des lignes verrouillées
/// sérialiserait les écritures sur `users` pour la durée d'un hachage. Ce qui
/// décide d'une écriture reste dans la transaction - la garde du dernier
/// administrateur et l'état du compte.
///
/// `deletedAt: null` dans le `where` de l'update est l'anti-rejeu au niveau de
/// la BASE : deux soumissions concurrentes passent toutes les deux la lecture,
/// c'est cette clause qui fait perdre la seconde en levant P2025.
export async function pseudonymiserCompte(params: {
  userId: string;
  motDePasse: string;
  maintenant: Date;
}): Promise<ResultatSuppressionCompte> {
  const provider = await db.authProvider.findUnique({
    where: { userId_provider: { userId: params.userId, provider: "local" } },
    select: { passwordHash: true },
  });

  // Un compte 100 % Google n'a pas de `password_hash`. Refus explicite plutôt
  // qu'un « mot de passe incorrect » qui enverrait la personne essayer
  // indéfiniment un secret qu'elle n'a jamais choisi.
  if (!provider?.passwordHash) {
    return { ok: false, reason: "sans_mot_de_passe" };
  }

  const valide = await verifyPassword(params.motDePasse, provider.passwordHash);
  if (!valide) return { ok: false, reason: "mot_de_passe_invalide" };

  return db.$transaction(async (tx) => {
    const utilisateur = await tx.user.findUnique({
      where: { id: params.userId, deletedAt: null },
      // L'email ANCIEN, lu avant de l'écraser : c'est la clé des compteurs de
      // `rate_limits`, que plus rien ne rattacherait au compte ensuite.
      select: { roles: true, email: true },
    });

    // Course perdue, ou compte déjà pseudonymisé : il n'y a plus rien à
    // effacer, donc c'est un succès du point de vue de l'appelant.
    if (!utilisateur) return { ok: true };

    if (utilisateur.roles.includes("ROLE_ADMIN")) {
      // Constitution §4.2 : le dernier administrateur ne peut être ni supprimé
      // ni rétrogradé. Garde applicative SEULE, le trigger PostgreSQL du double
      // filet (PLAN S2 §5) n'étant pas encore posé.
      //
      // ⚠️ **Sans le verrou de ligne, la garde ne tient pas.** Un `count` en
      // READ COMMITTED ne voit pas l'`UPDATE` non commité de la transaction
      // voisine : deux administrateurs qui se suppriment dans la même fenêtre
      // se comptent mutuellement comme vivants, passent tous les deux, et il
      // n'en reste aucun. Le `count` qui suit est la relecture SOUS verrou,
      // c'est elle qui décide.
      await tx.$queryRaw`
        SELECT "id" FROM "users"
        WHERE "roles" @> ARRAY['ROLE_ADMIN']::varchar[]
          AND "is_active" = true
          AND "deleted_at" IS NULL
        FOR UPDATE
      `;

      const autresAdmins = await tx.user.count({
        where: {
          id: { not: params.userId },
          roles: { has: "ROLE_ADMIN" },
          isActive: true,
          deletedAt: null,
        },
      });
      if (autresAdmins === 0) return { ok: false, reason: "dernier_admin" };
    }

    try {
      await tx.user.update({
        where: { id: params.userId, deletedAt: null },
        data: {
          firstname: PRENOM_PSEUDONYME,
          lastname: NOM_PSEUDONYME,
          email: emailPseudonyme(params.userId),
          phone: null,
          isActive: false,
          deletedAt: params.maintenant,
        },
      });
    } catch (erreur) {
      // P2025 signifie que `deletedAt: null` n'a rien matché, donc qu'une
      // transaction concurrente a commité la pseudonymisation entre notre
      // lecture et notre écriture. L'état final est celui que l'appelant
      // demandait : c'est un succès, et le traiter comme une panne laisserait
      // le perdant devant une erreur sur une opération irréversible réussie.
      if (isPrismaError(erreur, PRISMA_RECORD_NOT_FOUND)) return { ok: true };
      throw erreur;
    }

    // Les identifiants partent avec l'identité : le hash bcrypt désigne la
    // personne, les jetons Google ouvrent son compte tiers.
    await tx.authProvider.deleteMany({ where: { userId: params.userId } });
    await tx.verificationToken.deleteMany({ where: { userId: params.userId } });

    await tx.address.updateMany({
      where: { userId: params.userId },
      data: { street: RUE_PSEUDONYME, label: null, isActive: false },
    });

    // SQL brut : `location` est une colonne `Unsupported`, que le client Prisma
    // ne sait pas écrire. Les interventions gardent leur `address_id`, donc
    // leur historique reste lisible ; c'est la géométrie du domicile qui part.
    await tx.$executeRaw`
      UPDATE "addresses" SET "location" = NULL WHERE "user_id" = ${params.userId}::uuid
    `;

    // `cycles` porte marque, modèle et année rattachés à la personne, et
    // aucune obligation comptable ne les couvre. Anonymisés plutôt que
    // supprimés : casser la clé étrangère transformerait un droit à l'oubli en
    // perte d'historique.
    await tx.cycle.updateMany({
      where: { userId: params.userId },
      data: { brand: MARQUE_PSEUDONYME, model: null, year: null },
    });

    // ⚠️ `rate_limits` garde l'adresse en clair et n'a **aucune clé étrangère**
    // (délibéré, PLAN S4 §11.2) : rien ne la rattache au compte, et sa purge
    // opportuniste n'a lieu qu'à la prochaine lecture d'un compteur. Sans cet
    // effacement explicite, l'email survit à sa propre suppression.
    await tx.rateLimit.deleteMany({
      where: {
        key: {
          in: [
            loginRateLimitKey(utilisateur.email),
            activationRateLimitKey(utilisateur.email),
          ],
        },
      },
    });

    // Dans la MÊME transaction que la mutation qu'elle trace : une trace écrite
    // à côté survit à un rollback ou manque alors que l'écriture a eu lieu
    // (Constitution §4.2).
    //
    // `ANONYMIZE` et non `RGPD_DELETION` : le CHECK SQL de la migration 003 ne
    // connaît que six valeurs, et [[mcd-dictionnaire]] §audit_logs porte
    // `ANONYMIZE` pour cet évènement. Écart avec l'US signalé pour write-back.
    await writeAuditLog(
      {
        entityType: "users",
        entityId: params.userId,
        action: "ANONYMIZE",
        actorId: params.userId,
        details: { deletion_reason: "client_right_to_be_forgotten" },
      },
      tx,
    );

    return { ok: true };
  });
}
