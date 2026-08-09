import "server-only";

import { createSafeActionClient } from "next-safe-action";

import { getCurrentUser } from "@/lib/auth/dal";
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

/// Client des actions qui exigent une session, **sans exigence de rôle** — la
/// fiche client, ses adresses, ses cycles.
///
/// Même motif que ci-dessus pour la position en middleware : c'est le seul
/// endroit qui s'exécute avant la validation Zod. `getCurrentUser` redirige
/// vers `/connexion` en l'absence de session ; l'appelant anonyme n'atteint
/// donc jamais le corps de l'action, ni la forme de son schéma.
export const authActionClient = actionClient.use(async ({ next }) => {
  const user = await getCurrentUser();
  return next({ ctx: { user } });
});
