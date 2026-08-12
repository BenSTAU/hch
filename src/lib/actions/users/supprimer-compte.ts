"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { destroySession } from "@/lib/auth/session";
import {
  pseudonymiserCompte,
  type ResultatSuppressionCompte,
} from "@/lib/db/queries/users";
import { CHEMIN_COMPTE_SUPPRIME } from "@/lib/routes";
import { authActionClient } from "@/lib/safe-action";
import { supprimerCompteSchema } from "@/lib/validations/users";

/// Droit à l'oubli - `US-COMPTE-SUPPRIMER`.
///
/// Les gardes vivent dans le helper métier : mot de passe, dernier
/// administrateur et état du compte décident d'une écriture, elles appartiennent
/// donc à la transaction qui l'exécute. Cette action orchestre - validation,
/// contexte, invalidation, fin de session, redirection.

function messageRefus(
  echec: Extract<ResultatSuppressionCompte, { ok: false }>,
): string {
  switch (echec.reason) {
    case "mot_de_passe_invalide":
      // Libellé de l'US §Cas d'erreur. Aucune anti-énumération à tenir ici :
      // l'appelant est déjà authentifié, il n'apprend rien sur un tiers.
      return "Mot de passe incorrect";
    case "sans_mot_de_passe":
      return "Votre compte n'a pas de mot de passe : il a été créé par connexion Google. Contactez-nous pour exercer votre droit à l'oubli.";
    case "dernier_admin":
      // Libellé de l'US §Cas d'erreur, au mot près.
      return "Vous êtes le dernier administrateur - désignez un remplaçant avant de supprimer votre compte";
  }
}

export const supprimerCompte = authActionClient
  .inputSchema(supprimerCompteSchema)
  .action(async ({ parsedInput, ctx: { user } }) => {
    const resultat = await pseudonymiserCompte({
      // Le titulaire vient du CONTEXTE, jamais de la charge utile. Rappel
      // d'ADR-006 v2 : cette action est un endpoint POST public, et le 403 de
      // l'US §Cas d'erreur ne peut pas se produire - il n'y a pas
      // d'identifiant à soumettre.
      userId: user.id,
      motDePasse: parsedInput.motDePasse,
      maintenant: new Date(),
    });

    if (!resultat.ok) {
      // Aucune invalidation sur les refus : rien n'a changé en base, et l'écran
      // qui porte le message reste monté. C'est la différence avec l'annulation
      // d'intervention, dont deux refus sur trois signifiaient une vue périmée
      // (T-V3-11, PR #36).
      return { ok: false as const, message: messageRefus(resultat) };
    }

    // La session est stateless : ce cookie-ci part tout de suite, et les jetons
    // encore valables sur d'autres appareils deviennent inertes d'eux-mêmes,
    // `findUserById` filtrant `deletedAt: null` et `isActive: true`. La
    // déconnexion forcée de l'US vaut donc pour toutes les sessions, sans
    // mécanisme de révocation.
    await destroySession();

    // `"layout"` et non le chemin seul : le compte disparaît de l'en-tête, de
    // l'espace client et de ses deux listes à la fois. Invalider page par page
    // laisserait une vue en cache qui parle d'un compte qui n'existe plus.
    revalidatePath("/", "layout");

    // Hors de tout `try`/`catch` : `redirect` fonctionne par throw.
    redirect(CHEMIN_COMPTE_SUPPRIME);
  });
