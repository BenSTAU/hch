import "server-only";

import { createSafeActionClient } from "next-safe-action";

import { requireAdmin } from "@/lib/auth/permissions";

/// Client d'action de base. Rappel d'ADR-006 v2 : **chaque Server Action
/// exportée est un endpoint POST public**. La page qui protège ne protège pas
/// l'action — c'est ici, et dans chaque action, que la garde se pose.
///
/// `handleServerError` renvoie un message générique : une erreur Prisma non
/// interceptée porte l'hôte et l'utilisateur de la base, et remonterait
/// jusqu'au navigateur. Le détail part dans les logs du serveur.
export const actionClient = createSafeActionClient({
  handleServerError(error) {
    console.error("[action] erreur serveur :", error);
    return "Une erreur est survenue. Réessayez dans un instant.";
  },
});

/// Client des actions réservées à l'administration.
///
/// La garde vit en **middleware**, pas dans le corps de l'action. Ce n'est pas
/// cosmétique : next-safe-action exécute les middlewares, PUIS la validation
/// Zod, PUIS le corps (`index.mjs:535-570`). Une garde écrite en première
/// ligne du corps laissait donc un appelant anonyme déclencher le parsing de
/// la charge utile et lire la forme du schéma dans `validationErrors`.
/// CLAUDE.md §Server Actions demande d'authentifier « au début de chaque
/// action » — avec cette bibliothèque, le début, c'est ici.
///
/// Relevé par l'agent testeur sur T-J0-05 (B4). Aucune écriture n'était
/// atteignable par ce chemin ; c'est l'ordre qui était faux, pas la garde.
export const adminActionClient = actionClient.use(async ({ next }) => {
  const admin = await requireAdmin();
  return next({ ctx: { admin } });
});
