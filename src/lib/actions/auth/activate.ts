"use server";

import { redirect } from "next/navigation";

import {
  generateVerificationToken,
  hashVerificationToken,
  verificationTokenExpiry,
} from "@/lib/auth/verification-token";
import { isPrismaError, PRISMA_RECORD_NOT_FOUND } from "@/lib/db/prisma-error";
import {
  activateAccountWithToken,
  findAccountForSignup,
  findEmailVerificationToken,
  replacePendingEmailVerificationToken,
} from "@/lib/db/queries/auth";
import { sendActivationEmail } from "@/lib/email/activation";
import { dispatchEmail } from "@/lib/email/dispatch";
import {
  ACTIVATION_RESEND_LIMIT,
  ACTIVATION_RESEND_WINDOW_MS,
  activationRateLimitKey,
  consumeRateLimit,
} from "@/lib/rate-limit";
import { actionClient } from "@/lib/safe-action";
import {
  activationSchema,
  resendActivationSchema,
} from "@/lib/validations/auth";

/// `US-COMPTE-ACTIVER` §Cas nominal : « je suis redirigé vers la page de
/// connexion avec message “Compte activé, vous pouvez vous connecter” ».
///
/// Aucune session ouverte au passage, délibérément : activer n'est pas se
/// connecter, et un lien d'email qui ouvrirait une session ferait du contenu
/// d'une boîte email un identifiant suffisant.
const AFTER_ACTIVATION = "/connexion?compte=active";

/// Union discriminée des trois refus nommés par la SPEC. `invalid` reste
/// générique — pas d'énumération des jetons valides.
export type ActivationOutcome = "expired" | "already_used" | "invalid";

export const activateAccount = actionClient
  .inputSchema(activationSchema)
  .action(async ({ parsedInput: { token } }) => {
    const stored = await findEmailVerificationToken(
      hashVerificationToken(token),
    );

    if (!stored) {
      return { outcome: "invalid" as const };
    }

    // La consommation AVANT l'expiration, et l'ordre porte le message le plus
    // utile : « connectez-vous » plutôt que « demandez un nouveau lien » à
    // quelqu'un dont le compte est déjà activé.
    if (stored.usedAt !== null) {
      return { outcome: "already_used" as const };
    }

    const now = new Date();
    // Frontière incluse : `expires_at` est une échéance, pas une durée de grâce.
    if (stored.expiresAt.getTime() <= now.getTime()) {
      return { outcome: "expired" as const };
    }

    try {
      await activateAccountWithToken({
        tokenId: stored.id,
        userId: stored.userId,
        now,
      });
    } catch (error) {
      // P2025 : la course a été perdue — deux clics simultanés, le second arrive
      // après que le premier a marqué `used_at` — ou le compte n'est plus
      // éligible (déjà vérifié, pseudonymisé). Dans les deux cas la SPEC prévoit
      // le même message que pour un jeton consommé : « Compte déjà activé,
      // connectez-vous » (module-1-utilisateurs.md:222-224). Elle ne distingue
      // pas un jeton consommé il y a une heure de celui consommé il y a 40 ms.
      //
      // Sans cette branche, P2025 remontait en « une erreur est survenue » et
      // invitait à recliquer un lien mort — constat B4 de l'agent testeur.
      if (!isPrismaError(error, PRISMA_RECORD_NOT_FOUND)) throw error;
      return { outcome: "already_used" as const };
    }

    // Hors du try : `redirect()` fonctionne par throw, une capture le
    // transformerait en erreur serveur silencieuse.
    redirect(AFTER_ACTIVATION);
  });

export const resendActivation = actionClient
  .inputSchema(resendActivationSchema)
  .action(async ({ parsedInput: { email } }) => {
    // Le quota est décompté AVANT toute lecture de compte. PLAN S4 §11.2 : « le
    // compteur doit exister pour toute chaîne tentée ». Décompter après la
    // lecture laisserait marteler l'action avec des adresses inconnues sans
    // jamais consommer de jeton.
    const verdict = await consumeRateLimit(
      activationRateLimitKey(email),
      ACTIVATION_RESEND_LIMIT,
      ACTIVATION_RESEND_WINDOW_MS,
    );

    const compte = await findAccountForSignup(email);

    // Un jeton d'activation déjà consommé couvre deux états que `is_active` ne
    // distingue pas — compte activé, et compte désactivé par un administrateur.
    // Aucun envoi dans les deux cas.
    const eligible =
      verdict.allowed &&
      compte !== null &&
      !compte.hasCompletedEmailVerification;

    if (eligible) {
      const { token, tokenHash } = generateVerificationToken();
      await replacePendingEmailVerificationToken({
        userId: compte.id,
        tokenHash,
        expiresAt: verificationTokenExpiry(),
      });

      // Hors du chemin de réponse : l'aller-retour SMTP ne doit pas se lire au
      // chronomètre, et depuis l'arbitrage B2 son sort ne change plus la
      // réponse. Cf. `src/lib/email/dispatch.ts`.
      dispatchEmail(`renvoi activation ${email}`, () =>
        sendActivationEmail({
          to: email,
          firstname: compte.firstname,
          token,
        }),
      );
    }

    // Réponse identique dans TOUS les cas — adresse inconnue, compte déjà activé,
    // compte fermé par un administrateur, quota épuisé, envoi en échec. Un « trop
    // de tentatives » distinct ne s'afficherait que pour les adresses ayant un
    // compte en attente, et redeviendrait l'oracle que la table `rate_limits`
    // existe précisément pour éviter (PLAN S4 §11.2).
    return { sent: true as const };
  });

export type ActivationFormState = {
  outcome?: ActivationOutcome;
  error?: string;
};

export async function activateFormAction(
  _prevState: ActivationFormState,
  formData: FormData,
): Promise<ActivationFormState> {
  const result = await activateAccount({
    token: String(formData.get("token") ?? ""),
  });

  // Succès : `activateAccount` a déjà redirigé par throw. Un jeton malformé
  // n'atteint pas l'action — il est refusé par le schéma, et « lien invalide »
  // est le bon message pour ce cas aussi.
  if (result?.data?.outcome) {
    return { outcome: result.data.outcome };
  }

  if (result?.serverError) {
    return { error: result.serverError };
  }

  return { outcome: "invalid" };
}

export type ResendFormState = {
  sent?: boolean;
  error?: string;
};

export async function resendActivationFormAction(
  _prevState: ResendFormState,
  formData: FormData,
): Promise<ResendFormState> {
  const result = await resendActivation({
    email: String(formData.get("email") ?? ""),
  });

  // L'action n'a plus de canal d'échec d'envoi depuis l'arbitrage B2 : elle
  // répond `{ sent: true }` quoi qu'il advienne du transport. Ne restent que deux
  // motifs de retour distinct, et aucun ne dépend de l'existence du compte —
  // une adresse mal formée, et une panne serveur.
  if (result?.validationErrors) {
    return { error: "Renseignez une adresse email valide." };
  }

  if (result?.serverError) {
    return { error: result.serverError };
  }

  return { sent: true };
}
