"use server";

import { redirect } from "next/navigation";

import { hashPassword } from "@/lib/auth/password";
import {
  generateVerificationToken,
  verificationTokenExpiry,
} from "@/lib/auth/verification-token";
import {
  createLocalAccount,
  findAccountForSignup,
  replacePendingEmailVerificationToken,
} from "@/lib/db/queries/auth";
import { sendActivationEmail } from "@/lib/email/activation";
import {
  ACTIVATION_RESEND_LIMIT,
  ACTIVATION_RESEND_WINDOW_MS,
  activationRateLimitKey,
  consumeRateLimit,
} from "@/lib/rate-limit";
import { actionClient } from "@/lib/safe-action";
import {
  EMAIL_DELIVERY_FAILED_MESSAGE,
  signupSchema,
} from "@/lib/validations/auth";

/// Écran unique de sortie, pour les trois issues.
///
/// La SPEC décrit DEUX retours différents — « Vérifiez votre email » au nominal
/// (module-1-utilisateurs.md:160), le message générique sur email déjà pris
/// (:165). Deux retours distincts sont un oracle d'énumération : il suffit de
/// soumettre une adresse pour savoir si elle a un compte. On unifie, et l'écran
/// porte les deux formulations. Écart déclaré dans le body de PR.
const AFTER_SIGNUP = "/inscription/confirmation";

/// Aucune écriture dans `audit_logs` : Constitution §4.2 borne le journal aux
/// suppressions, modifications tarifaires et anonymisations.
export const signup = actionClient
  .inputSchema(signupSchema)
  .action(async ({ parsedInput }) => {
    const { firstname, lastname, email, password } = parsedInput;

    // AVANT toute lecture en base, et sur TOUS les chemins. Le hachage coûte
    // ~21 ms ; un chemin qui l'éviterait répondrait en 0,03 ms et l'existence
    // du compte se lirait au chronomètre. C'est l'écart de 1 300× à 16 000×
    // mesuré sur la connexion en T-J0-04, qui se rouvrirait ici par une autre
    // porte (src/lib/auth/authenticate.ts:21-27).
    const passwordHash = await hashPassword(password);

    const compte = await findAccountForSignup(email);

    let envoye = true;

    if (!compte) {
      const { token, tokenHash } = generateVerificationToken();
      await createLocalAccount({
        email,
        firstname,
        lastname,
        passwordHash,
        tokenHash,
        expiresAt: verificationTokenExpiry(),
      });
      envoye = await envoyer({ to: email, firstname, token });
    } else if (!compte.hasCompletedEmailVerification) {
      // Compte en attente d'activation : la soumission vaut demande de renvoi,
      // donc elle passe par le quota (module-1-utilisateurs.md:233).
      //
      // Le cas complémentaire — un jeton d'activation déjà consommé — couvre à
      // la fois le compte activé et le compte désactivé par un administrateur,
      // que `is_active` ne distingue pas. Aucun email dans les deux cas : un
      // lien d'activation réactiverait un compte que l'admin a fermé.
      const verdict = await consumeRateLimit(
        activationRateLimitKey(email),
        ACTIVATION_RESEND_LIMIT,
        ACTIVATION_RESEND_WINDOW_MS,
      );

      if (verdict.allowed) {
        const { token, tokenHash } = generateVerificationToken();
        await replacePendingEmailVerificationToken({
          userId: compte.id,
          tokenHash,
          expiresAt: verificationTokenExpiry(),
        });
        // Le prénom ENREGISTRÉ : l'email part à l'adresse d'un tiers, et son
        // contenu ne doit pas être choisi par qui soumet le formulaire.
        envoye = await envoyer({
          to: email,
          firstname: compte.firstname,
          token,
        });
      }
    }

    // ADR-017 : échec d'envoi bruyant. Rediriger vers « vérifiez votre email »
    // après un envoi raté enverrait la personne attendre un message qui
    // n'arrivera jamais.
    if (!envoye) {
      return { error: EMAIL_DELIVERY_FAILED_MESSAGE };
    }

    // `redirect()` hors de tout try/catch — il fonctionne par throw, une capture
    // le transformerait en erreur serveur silencieuse.
    redirect(AFTER_SIGNUP);
  });

/// Isole le `try` du `redirect`, et ramène l'échec à un booléen : le détail SMTP
/// reste dans les logs du conteneur, jamais dans la réponse.
async function envoyer(params: {
  to: string;
  firstname: string;
  token: string;
}): Promise<boolean> {
  try {
    await sendActivationEmail(params);
    return true;
  } catch (error) {
    console.error("[signup] email d'activation non envoyé :", error);
    return false;
  }
}

type ChampInscription =
  "firstname" | "lastname" | "email" | "password" | "passwordConfirmation";

/// Ordre du formulaire, et non ordre des clés de l'objet d'erreurs : c'est lui
/// qui décide sur quel champ le focus atterrit (WCAG 3.3.3 AA).
const CHAMPS: readonly ChampInscription[] = [
  "firstname",
  "lastname",
  "email",
  "password",
  "passwordConfirmation",
];

export type SignupFormState = {
  error?: string;
  fieldErrors?: Partial<Record<ChampInscription, string>>;
  /// Réaffichés après un refus — mais **jamais** les mots de passe : les
  /// remettre dans la réponse les mettrait dans le cache du navigateur.
  values?: { firstname: string; lastname: string; email: string };
};

/// Adaptateur `useActionState` — c'est **cette** fonction que
/// `<form action={…}>` référence, et c'est ce qui rend la soumission
/// fonctionnelle avant hydratation. Même motif qu'à la connexion
/// (`src/lib/actions/auth/login.ts`) : `next-safe-action` attend un objet typé
/// par son schéma quand React passe un `FormData`.
export async function signupFormAction(
  _prevState: SignupFormState,
  formData: FormData,
): Promise<SignupFormState> {
  const champ = (nom: string): string => String(formData.get(nom) ?? "");

  const result = await signup({
    firstname: champ("firstname"),
    lastname: champ("lastname"),
    email: champ("email"),
    password: champ("password"),
    passwordConfirmation: champ("passwordConfirmation"),
  });

  // En cas de succès, `signup` a déjà lancé la redirection par throw : ce point
  // n'est atteint que sur un refus.
  const values = {
    firstname: champ("firstname"),
    lastname: champ("lastname"),
    email: champ("email"),
  };

  const fieldErrors: Partial<Record<ChampInscription, string>> = {};
  for (const nom of CHAMPS) {
    const message = premierMessage(result?.validationErrors, nom);
    if (message !== undefined) fieldErrors[nom] = message;
  }

  const erreurGlobale =
    result?.data?.error ??
    result?.serverError ??
    (Object.keys(fieldErrors).length > 0
      ? "Vérifiez les champs du formulaire."
      : undefined);

  return {
    ...(erreurGlobale === undefined ? {} : { error: erreurGlobale }),
    ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
    values,
  };
}

/// `next-safe-action` expose ses erreurs de validation sous la forme
/// `{ champ: { _errors: string[] } }`. La forme est lue défensivement plutôt que
/// typée : elle appartient à la bibliothèque, pas à nous.
function premierMessage(erreurs: unknown, champ: string): string | undefined {
  if (typeof erreurs !== "object" || erreurs === null) return undefined;

  const entree = (erreurs as Record<string, unknown>)[champ];
  if (typeof entree !== "object" || entree === null) return undefined;

  const liste = (entree as { _errors?: unknown })._errors;
  return Array.isArray(liste) && typeof liste[0] === "string"
    ? liste[0]
    : undefined;
}
