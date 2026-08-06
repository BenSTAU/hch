import "server-only";

import { createSafeActionClient } from "next-safe-action";

import { requireAdmin } from "@/lib/auth/permissions";

/// Client d'action de base. Rappel d'ADR-006 v2 : **chaque Server Action
/// exportée est un endpoint POST public** — la page qui protège ne protège pas
/// l'action. `handleServerError` renvoie un message générique parce qu'une
/// erreur Prisma non interceptée porte l'hôte et l'utilisateur de la base.
export const actionClient = createSafeActionClient({
  handleServerError(error) {
    console.error("[action] erreur serveur :", error);
    return "Une erreur est survenue. Réessayez dans un instant.";
  },
});

/// Client des actions réservées à l'administration.
///
/// La garde vit en **middleware** et non dans le corps de l'action, parce que
/// next-safe-action exécute les middlewares PUIS la validation Zod PUIS le
/// corps : dans le corps, un appelant anonyme déclenche le parsing et lit la
/// forme du schéma. Avec cette bibliothèque, « au début de l'action » c'est
/// ici — cf. TASKS T-J0-05 §Divergences (B4).
export const adminActionClient = actionClient.use(async ({ next }) => {
  const admin = await requireAdmin();
  return next({ ctx: { admin } });
});
