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

/// État rendu par le formulaire de connexion. Un seul champ : les quatre
/// causes de refus partagent un message unique (anti-énumération,
/// Constitution §4.2).
export type LoginFormState = { error?: string };

/// Adaptateur `useActionState` — c'est **cette** fonction que
/// `<form action={…}>` référence, et c'est ce qui rend la soumission
/// fonctionnelle avant hydratation.
///
/// Elle existe parce que `next-safe-action` attend un objet typé par son
/// schéma, quand React passe un `FormData` : les deux ne se branchent pas
/// directement (vérifié sur la 8.6, `FormData` n'apparaît nulle part dans ses
/// types). La conversion vit donc ici, du côté serveur, plutôt que dans un
/// `onSubmit` client qui ne s'exécute qu'une fois React chargé.
///
/// Ce que ça corrige : un `<form>` sans attribut `action` se soumet
/// NATIVEMENT en GET tant que React n'a pas hydraté — tous les champs en query
/// string, mot de passe compris, donc dans l'historique du navigateur, les
/// journaux d'accès nginx et l'en-tête `Referer`. Observé en E2E sur T-J0-09.
export async function loginFormAction(
  _prevState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  // `next` transite par un champ caché, seule voie qui survive à l'absence de
  // JavaScript. Il reste manipulable — c'était déjà vrai — et c'est
  // `safeNextPath`, côté action, qui en décide.
  const next = formData.get("next");

  const result = await login({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    // Omis plutôt que transmis vide : le schéma le rend facultatif, et une
    // clé présente à `""` n'a pas le même sens qu'une clé absente.
    ...(typeof next === "string" && next !== "" ? { next } : {}),
  });

  // En cas de succès, `login` a déjà lancé la redirection par throw : ce point
  // n'est atteint que sur un refus.
  return {
    error:
      result?.data?.error ??
      result?.serverError ??
      (result?.validationErrors
        ? "Vérifiez les champs du formulaire."
        : undefined),
  };
}
