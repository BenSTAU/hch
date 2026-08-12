import "server-only";

import { writeAuditLog } from "@/lib/audit/log";
import { verifyPassword } from "@/lib/auth/password";
import { db } from "@/lib/db/client";
import { isPrismaError, PRISMA_RECORD_NOT_FOUND } from "@/lib/db/prisma-error";
import { activationRateLimitKey, loginRateLimitKey } from "@/lib/rate-limit";

/// Helpers métier du domaine `users` - testables sans contexte Next. Aucun
/// `revalidatePath`, aucun `redirect` : ils vivent dans la Server Action.

/// Valeurs de pseudonymisation, alignées sur PLAN S2 §T6 qui les a fixées
/// contre le dictionnaire (`'Client'` / `'supprimé'`).
///
/// **Pseudonymisation, pas anonymisation**, et la qualification structure le
/// code plutôt qu'elle ne le décore : les clés étrangères vers `interventions`
/// et `payments` restent intactes pour l'obligation comptable, donc la personne
/// reste ré-identifiable par croisement, donc le RGPD continue de s'appliquer à
/// ces lignes. C'est ce qui interdit d'écrire « vos données disparaissent »
/// dans l'interface (S4 §4.4).
export const PRENOM_PSEUDONYME = "Utilisateur";
export const NOM_PSEUDONYME = "Anonymisé";
export const RUE_PSEUDONYME = "Anonymisée";
/// `cycles.brand` est NOT NULL : la marque est remplacée, le modèle et l'année
/// tombent à NULL. Valeur ajoutée sur constat de l'agent testeur (B2), PLAN S2
/// §T6 ne couvrant que `users`.
export const MARQUE_PSEUDONYME = "Anonymisé";

/// `deleted-<uuid>@anon.local` - `US-COMPTE-SUPPRIMER` §Cas nominal.
///
/// Le domaine `anon.local` n'existe pas, et c'est voulu : l'adresse doit rester
/// unique (l'index de `users.email` ne connaît pas la pseudonymisation) sans
/// jamais être joignable. L'identifiant est déjà la clé primaire, le réutiliser
/// ici n'expose rien de neuf.
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
/// ── Ce qui est vérifié avant d'écrire, et dans quel ordre
///
/// Le mot de passe se vérifie **hors** de la transaction : `bcrypt.compare`
/// coûte une centaine de millisecondes, et les tenir avec des lignes verrouillées
/// sérialiserait les écritures sur `users` pour la durée d'un hachage. Ce qui
/// décide d'une écriture reste dans la transaction - la garde du dernier
/// administrateur et l'état du compte.
///
/// ── L'action est irréversible et se joue une seule fois
///
/// `deletedAt: null` dans le `where` de l'update est l'anti-rejeu au niveau de
/// la BASE : deux soumissions concurrentes passent toutes les deux la lecture,
/// c'est cette clause qui fait perdre la seconde en levant P2025. Même motif
/// qu'`activateAccountWithToken`.
export async function pseudonymiserCompte(params: {
  userId: string;
  motDePasse: string;
  maintenant: Date;
}): Promise<ResultatSuppressionCompte> {
  const provider = await db.authProvider.findUnique({
    where: { userId_provider: { userId: params.userId, provider: "local" } },
    select: { passwordHash: true },
  });

  // Un compte 100 % Google n'a pas de `password_hash` (`AuthProvider`
  // §passwordHash), et `US-COMPTE-SUPPRIMER` ne connaît que la confirmation par
  // mot de passe. Refus explicite plutôt qu'un « mot de passe incorrect » qui
  // enverrait la personne essayer indéfiniment un secret qu'elle n'a jamais
  // choisi. Aucun compte de ce type n'existe tant que T-V3-04 n'a pas livré
  // l'OAuth ; c'est sa DoD qui porte le second facteur de confirmation.
  if (!provider?.passwordHash) {
    return { ok: false, reason: "sans_mot_de_passe" };
  }

  const valide = await verifyPassword(params.motDePasse, provider.passwordHash);
  if (!valide) return { ok: false, reason: "mot_de_passe_invalide" };

  return db.$transaction(async (tx) => {
    const utilisateur = await tx.user.findUnique({
      where: { id: params.userId, deletedAt: null },
      // L'email ANCIEN, lu avant de l'écraser : c'est la clé des compteurs de
      // `rate_limits`, qui ne portent aucune clé étrangère et que rien d'autre
      // ne rattacherait à ce compte une fois l'adresse remplacée.
      select: { roles: true, email: true },
    });

    // Course perdue, ou compte déjà pseudonymisé. Le parcours est terminé du
    // point de vue de l'appelant : il n'y a plus rien à effacer.
    if (!utilisateur) return { ok: true };

    if (utilisateur.roles.includes("ROLE_ADMIN")) {
      // Constitution §4.2 : le dernier administrateur ne peut être ni supprimé
      // ni rétrogradé. La garde est ici parce que le trigger PostgreSQL du
      // double filet (PLAN S2 §5) n'est pas posé - il appartient à
      // `US-UTILISATEUR-MODIFIER`, en vague V1. Écart signalé, pas absorbé.
      //
      // 🐛 **Le verrou de ligne n'y était pas, et sans lui la garde ne tient
      // pas** (agent testeur, B1). Un `count` en READ COMMITTED ne voit pas
      // l'`UPDATE` non commité de la transaction voisine : deux administrateurs
      // qui se suppriment dans la même fenêtre se comptent mutuellement comme
      // vivants, passent tous les deux, et il n'en reste aucun - état
      // irrécupérable par l'interface, sur une opération irréversible, sans
      // trigger pour rattraper.
      //
      // `FOR UPDATE` sur les lignes administrateur sérialise ces suppressions
      // entre elles, et elles seules : un client n'atteint jamais cette
      // branche. Même motif que le `SELECT … FOR UPDATE` de
      // `annulerInterventionDuClient`, et le `count` qui suit est la relecture
      // SOUS verrou - c'est elle qui décide, la première lecture n'a servi
      // qu'aux gardes.
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
      // 🐛 **Le perdant d'une double soumission voyait « une erreur est
      // survenue » sur un compte pourtant effacé** (agent testeur, B4).
      //
      // P2025 signifie ici que la clause `deletedAt: null` n'a rien matché,
      // donc qu'une transaction concurrente a commité la pseudonymisation
      // entre notre lecture et notre écriture. L'état final est celui que
      // l'appelant demandait : c'est un succès, et le traiter comme une panne
      // le laissait devant un message d'erreur avec sa session encore ouverte,
      // sur une opération irréversible réussie.
      //
      // Le rejeu SÉQUENTIEL rendait déjà `{ ok: true }` plus haut. Les deux
      // chemins mènent au même état, ils rendent désormais la même réponse.
      if (isPrismaError(erreur, PRISMA_RECORD_NOT_FOUND)) return { ok: true };
      throw erreur;
    }

    // Les identifiants partent avec l'identité : le hash bcrypt est un secret
    // qui désigne la personne, les jetons Google donnent accès à son compte
    // tiers. Les laisser vivre sur une ligne pseudonymisée conserverait des
    // données personnelles que plus rien ne justifie.
    await tx.authProvider.deleteMany({ where: { userId: params.userId } });
    await tx.verificationToken.deleteMany({ where: { userId: params.userId } });

    await tx.address.updateMany({
      where: { userId: params.userId },
      data: { street: RUE_PSEUDONYME, label: null, isActive: false },
    });

    // `location` en SQL brut : la colonne est `Unsupported`, le client Prisma
    // ne sait pas l'écrire (même motif que `creerAdresse`). Les interventions
    // gardent leur `address_id`, donc leur historique reste lisible ; c'est la
    // géométrie du domicile qui part, arbitrée le 2026-08-11 (migration 015).
    await tx.$executeRaw`
      UPDATE "addresses" SET "location" = NULL WHERE "user_id" = ${params.userId}::uuid
    `;

    // 🐛 **Les vélos survivaient intacts** (agent testeur, B2). `cycles` porte
    // marque, modèle et année rattachés à la personne, et **aucune obligation
    // comptable ne les couvre** : `interventions.cycle_id` est NULLable et rien
    // ne l'écrit en v1. Anonymisés plutôt que supprimés - la clé étrangère
    // existe, et la casser le jour où quelque chose l'écrira transformerait un
    // droit à l'oubli en perte d'historique.
    //
    // Aucun vélo n'existe au HEAD courant, le CRUD arrive avec T-V3-07. C'est
    // précisément pour ça qu'il fallait le poser maintenant : l'omission serait
    // devenue invisible.
    await tx.cycle.updateMany({
      where: { userId: params.userId },
      data: { brand: MARQUE_PSEUDONYME, model: null, year: null },
    });

    // 🐛 **Les compteurs de `rate_limits` gardaient l'adresse en clair** (agent
    // testeur, B3). La table n'a aucune clé étrangère - c'est délibéré, PLAN S4
    // §11.2 - donc rien ne la rattachait au compte, et sa purge est
    // opportuniste : elle ne s'exécute qu'à la prochaine lecture d'un compteur,
    // par n'importe quel visiteur. Sur un site sans trafic, l'email survivait à
    // son propre effacement.
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

    // Dans la MÊME transaction que la mutation qu'elle trace. Une trace écrite
    // à côté survit à un rollback ou manque alors que l'écriture a eu lieu, et
    // c'est la pièce qu'on produit en cas de contestation (Constitution §4.2).
    //
    // `ANONYMIZE` et non `RGPD_DELETION` : le CHECK SQL de la migration 003 ne
    // connaît que six valeurs, et le dictionnaire §audit_logs porte déjà
    // `ANONYMIZE` pour cet évènement. L'US se trompe, elle est corrigée au
    // write-back - de même que `metadata`, colonne qui s'appelle `details`.
    //
    // L'acteur est le client lui-même : la description du dictionnaire
    // (« admin/tech qui a effectué l'action ») est plus étroite que la colonne.
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
