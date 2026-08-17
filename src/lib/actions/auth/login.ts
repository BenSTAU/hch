"use server";

import { redirect } from "next/navigation";

import { ENTITE_SESSION, writeAuditLog } from "@/lib/audit/log";
import { afterLoginPath } from "@/lib/auth/after-login";
import { authenticateWithPassword } from "@/lib/auth/authenticate";
import { safeNextPath } from "@/lib/auth/next-path";
import { createSession } from "@/lib/auth/session";
import {
  LOGIN_FAILURE_LIMIT,
  LOGIN_LOCKOUT_MS,
  clearRateLimit,
  loginRateLimitKey,
  peekLoginLockout,
  recordRateLimitAttempt,
} from "@/lib/rate-limit";
import { actionClient } from "@/lib/safe-action";
import {
  LOGIN_RATE_LIMITED_MESSAGE,
  LOGIN_REFUSED_MESSAGE,
  loginSchema,
} from "@/lib/validations/auth";

export const login = actionClient
  .inputSchema(loginSchema)
  .action(async ({ parsedInput: { email, password, next } }) => {
    // 5 échecs par email, puis 10 minutes de blocage ferme (SPEC §298-300,
    // PLAN S4 §11.1). La clé compte pour toute chaîne tentée, compte ou non :
    // la sortie anticipée ne révèle donc rien d'autre que le martèlement.
    const cle = loginRateLimitKey(email);
    const quota = await peekLoginLockout(
      cle,
      LOGIN_FAILURE_LIMIT,
      LOGIN_LOCKOUT_MS,
    );

    if (!quota.allowed) {
      // Le délai RESTANT ne traverse pas : à la seconde près, il daterait le
      // 5e échec, donc l'activité d'un tiers sur cette adresse. Le message
      // porte la durée du verrou, qui est une constante et ne date rien.
      return { error: LOGIN_RATE_LIMITED_MESSAGE, blocked: true };
    }

    const result = await authenticateWithPassword(email, password);

    // Une seule branche d'échec, un seul message, un seul temps de réponse :
    // les quatre causes passent toutes par bcrypt (leurre `DECOY_HASH` de
    // `src/lib/auth/authenticate.ts`). Anti-énumération, Constitution §4.2.
    if (!result.ok) {
      await recordRateLimitAttempt(cle);
      return { error: LOGIN_REFUSED_MESSAGE };
    }

    // Purge sur succès : le compteur n'oublie pas au fil du temps, donc sans
    // elle quatre erreurs de frappe resteraient armées indéfiniment.
    await clearRateLimit(cle);

    await createSession(result.user.id, result.user.roles);

    // Audit de connexion, cf. ADR-005 §Flux. **Après** `createSession` : il
    // n'y a pas de transaction ici, et une trace écrite pour une session non
    // créée ne se rattraperait pas. Les échecs ne sont pas tracés, une
    // tentative sur un email inconnu n'ayant aucun acteur à nommer.
    await writeAuditLog({
      entityType: ENTITE_SESSION,
      entityId: result.user.id,
      action: "LOGIN",
      actorId: result.user.id,
    });

    // `next` consommé APRÈS authentification seulement : sinon la page de
    // connexion serait un redirecteur ouvert utilisable sans compte.
    // `redirect()` hors de tout try/catch, il fonctionne par throw.
    redirect(safeNextPath(next) ?? afterLoginPath(result.user.roles));
  });

/// État rendu par le formulaire de connexion. `blocked` ne distingue aucune
/// cause de refus : il signale le plafond d'échecs, qui vaut pour toute
/// adresse tentée, compte ou non (anti-énumération, Constitution §4.2).
export type LoginFormState = { error?: string; blocked?: boolean };

/// Adaptateur `useActionState` : `next-safe-action` attend un objet typé par
/// son schéma, React passe un `FormData`, les deux ne se branchent pas.
///
/// ⚠️ La conversion vit côté SERVEUR, pas dans un `onSubmit` client. Un
/// `<form>` sans attribut `action` se soumet nativement en GET tant que React
/// n'a pas hydraté : mot de passe en query string, donc dans l'historique du
/// navigateur, les journaux nginx et l'en-tête `Referer`.
export async function loginFormAction(
  _prevState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  // `next` transite par un champ caché, seule voie qui survive à l'absence de
  // JavaScript. Manipulable par construction : c'est `safeNextPath`, côté
  // action, qui en décide.
  const next = formData.get("next");

  const result = await login({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    // Omis plutôt que transmis vide : une clé présente à `""` n'a pas le même
    // sens qu'une clé absente pour le schéma.
    ...(typeof next === "string" && next !== "" ? { next } : {}),
  });

  // `login` redirige par throw en cas de succès : ce point n'est atteint que
  // sur un refus.
  return {
    error:
      result?.data?.error ??
      result?.serverError ??
      (result?.validationErrors
        ? "Vérifiez les champs du formulaire."
        : undefined),
    // Absent plutôt qu'à `false` : le formulaire teste la présence du drapeau.
    ...(result?.data?.blocked ? { blocked: true } : {}),
  };
}
