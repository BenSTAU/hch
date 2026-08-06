"use server";

import { redirect } from "next/navigation";

import { authenticateWithPassword } from "@/lib/auth/authenticate";
import { safeNextPath } from "@/lib/auth/next-path";
import { createSession } from "@/lib/auth/session";
import { actionClient } from "@/lib/safe-action";
import { LOGIN_REFUSED_MESSAGE, loginSchema } from "@/lib/validations/auth";

/// Destination post-connexion par défaut. La SPEC prévoit trois espaces selon
/// le rôle, dont aucun n'existe au jalon 0 — cf. TASKS T-J0-05 §Divergences.
const AFTER_LOGIN = "/admin/parametres";

export const login = actionClient
  .inputSchema(loginSchema)
  .action(async ({ parsedInput: { email, password, next } }) => {
    const result = await authenticateWithPassword(email, password);

    // Une seule branche d'échec, un seul message — et un seul temps de
    // réponse : les quatre causes passent toutes par bcrypt
    // (`src/lib/auth/authenticate.ts`, leurre `DECOY_HASH`).
    if (!result.ok) {
      return { error: LOGIN_REFUSED_MESSAGE };
    }

    await createSession(result.user.id, result.user.roles);

    // `next` consommé APRÈS authentification seulement : sinon la page de
    // connexion serait un redirecteur ouvert utilisable sans compte. Et
    // `redirect()` hors de tout try/catch — il fonctionne par throw, une
    // capture le transformerait en erreur serveur silencieuse.
    redirect(safeNextPath(next) ?? AFTER_LOGIN);
  });
