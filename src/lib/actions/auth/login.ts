"use server";

import { redirect } from "next/navigation";

import { authenticateWithPassword } from "@/lib/auth/authenticate";
import { safeNextPath } from "@/lib/auth/next-path";
import { createSession } from "@/lib/auth/session";
import { actionClient } from "@/lib/safe-action";
import { LOGIN_REFUSED_MESSAGE, loginSchema } from "@/lib/validations/auth";

/// Destination post-connexion par défaut. La SPEC prévoit trois espaces
/// distincts selon le rôle — `/mes-interventions/a-venir`,
/// `/interventions/du-jour`, back-office — mais **aucun n'existe au jalon 0**,
/// dont la seule entité de bout en bout est `app_settings`. Écart signalé en
/// PR, à rouvrir quand les trois espaces existeront.
const AFTER_LOGIN = "/admin/parametres";

export const login = actionClient
  .inputSchema(loginSchema)
  .action(async ({ parsedInput: { email, password, next } }) => {
    const result = await authenticateWithPassword(email, password);

    // Une seule branche d'échec, un seul message. Le temps de réponse diffère
    // encore selon la cause — bcrypt n'est pas appelé sur un email inconnu —
    // c'est une fuite par canal auxiliaire, signalée en PR.
    if (!result.ok) {
      return { error: LOGIN_REFUSED_MESSAGE };
    }

    await createSession(result.user.id, result.user.roles);

    // Le `next` n'est consommé QU'ICI, après authentification réussie : une
    // redirection ouverte accessible sans compte serait un redirecteur offert
    // à qui veut. `safeNextPath` refuse tout ce qui sort du site, et un refus
    // ne fait pas échouer la connexion — elle a réussi.
    //
    // `redirect()` hors de tout try/catch : il fonctionne par throw, et une
    // capture le transformerait en erreur serveur silencieuse (leçon Argo).
    redirect(safeNextPath(next) ?? AFTER_LOGIN);
  });
