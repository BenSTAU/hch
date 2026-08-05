import "server-only";

import { createSafeActionClient } from "next-safe-action";

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
