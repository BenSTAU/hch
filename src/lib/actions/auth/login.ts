"use server";

import { redirect } from "next/navigation";

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
    // 5 échecs par email, puis 10 minutes de blocage ferme (SPEC §298-300
    // amendée le 2026-08-09, PLAN S4 §11.1). Reporté de T-J0-04 : le leurre
    // bcrypt d'`authenticate.ts` ferme la fuite d'INFORMATION, pas celle de
    // DÉBIT, et sans plafond un attaquant garde le droit d'essayer sans fin.
    //
    // La sortie anticipée ci-dessous répond sans passer par bcrypt, donc plus
    // vite. Ce n'est pas le canal temporel refermé en T-J0-04 : la clé compte
    // pour TOUTE chaîne tentée, compte ou non, et le chronomètre ne distingue
    // donc que « cette adresse a déjà été martelée », ce que le message dit
    // déjà en clair.
    const cle = loginRateLimitKey(email);
    const quota = await peekLoginLockout(
      cle,
      LOGIN_FAILURE_LIMIT,
      LOGIN_LOCKOUT_MS,
    );

    if (!quota.allowed) {
      // `blocked` sert au formulaire à fermer la porte côté navigateur, la
      // SPEC demande le blocage « front ET serveur ». Le délai RESTANT, lui,
      // ne traverse pas : à la seconde près, il daterait le 5e échec, donc
      // l'activité d'un tiers sur cette adresse. Le message porte la durée du
      // verrou, qui est une constante et ne date rien.
      return { error: LOGIN_RATE_LIMITED_MESSAGE, blocked: true };
    }

    const result = await authenticateWithPassword(email, password);

    // Une seule branche d'échec, un seul message - et un seul temps de
    // réponse : les quatre causes passent toutes par bcrypt
    // (`src/lib/auth/authenticate.ts`, leurre `DECOY_HASH`).
    if (!result.ok) {
      await recordRateLimitAttempt(cle);
      return { error: LOGIN_REFUSED_MESSAGE };
    }

    // Le compteur est purgé sur succès : quatre erreurs de frappe suivies du
    // bon mot de passe ne doivent pas laisser une mine armée pour la suite.
    // Depuis le blocage ferme, c'est aussi ce qui empêche quatre échecs
    // anciens de s'additionner à un échec futur, le compteur n'oubliant plus
    // au fil du temps.
    await clearRateLimit(cle);

    await createSession(result.user.id, result.user.roles);

    // `next` consommé APRÈS authentification seulement : sinon la page de
    // connexion serait un redirecteur ouvert utilisable sans compte. À défaut,
    // la destination dépend du rôle (`src/lib/auth/after-login.ts`) - un client
    // envoyé au back-office y trouverait un 403.
    //
    // `redirect()` hors de tout try/catch - il fonctionne par throw, une
    // capture le transformerait en erreur serveur silencieuse.
    redirect(safeNextPath(next) ?? afterLoginPath(result.user.roles));
  });

/// État rendu par le formulaire de connexion.
///
/// Un seul message pour les quatre causes de refus (anti-énumération,
/// Constitution §4.2). `blocked` ne les distingue pas : il signale le plafond
/// d'échecs, qui vaut pour toute adresse tentée - compte ou non.
export type LoginFormState = { error?: string; blocked?: boolean };

/// Adaptateur `useActionState` - c'est **cette** fonction que
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
/// NATIVEMENT en GET tant que React n'a pas hydraté - tous les champs en query
/// string, mot de passe compris, donc dans l'historique du navigateur, les
/// journaux d'accès nginx et l'en-tête `Referer`. Observé en E2E sur T-J0-09.
export async function loginFormAction(
  _prevState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  // `next` transite par un champ caché, seule voie qui survive à l'absence de
  // JavaScript. Il reste manipulable - c'était déjà vrai - et c'est
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
    // Absent plutôt qu'à `false` : le formulaire teste la présence du drapeau,
    // et un `blocked: false` traînant sur chaque refus ordinaire brouillerait
    // la lecture de l'état.
    ...(result?.data?.blocked ? { blocked: true } : {}),
  };
}
