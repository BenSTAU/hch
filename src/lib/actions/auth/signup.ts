"use server";

import { redirect } from "next/navigation";

import { safeNextPath } from "@/lib/auth/next-path";
import { hashPassword } from "@/lib/auth/password";
import {
  generateVerificationToken,
  verificationTokenExpiry,
} from "@/lib/auth/verification-token";
import { isPrismaError, PRISMA_UNIQUE_VIOLATION } from "@/lib/db/prisma-error";
import {
  createLocalAccount,
  findAccountForSignup,
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
import { signupSchema } from "@/lib/validations/auth";

/// Écran unique de sortie, pour les trois issues. Deux retours distincts
/// seraient un oracle d'énumération : soumettre une adresse suffirait à savoir
/// si elle a un compte. Écart assumé avec la SPEC, cf. [[module-1-utilisateurs]].
const AFTER_SIGNUP = "/inscription/confirmation";

/// Aucune écriture dans `audit_logs` : Constitution §4.2 borne le journal aux
/// suppressions, modifications tarifaires et anonymisations.
export const signup = actionClient
  .inputSchema(signupSchema)
  .action(async ({ parsedInput }) => {
    const { firstname, lastname, email, password, phone } = parsedInput;

    // Arbitrée AVANT de partir dans un email : ce qui n'est pas un chemin
    // interne ne voyage pas. Le lien survit à la session et se transfère.
    const retour = safeNextPath(parsedInput.next) ?? undefined;

    // AVANT toute lecture en base, et sur TOUS les chemins. Le hachage coûte
    // ~21 ms ; un chemin qui l'éviterait répondrait en 0,03 ms et l'existence
    // du compte se lirait au chronomètre. Même leurre que
    // `src/lib/auth/authenticate.ts`.
    const passwordHash = await hashPassword(password);

    const compte = await findAccountForSignup(email);

    if (!compte) {
      const { token, tokenHash } = generateVerificationToken();

      // La lecture ci-dessus et cette insertion ne sont pas atomiques, et ne
      // peuvent pas l'être sans sérialiser toutes les inscriptions : c'est
      // l'index unique qui arbitre, en P2002. Le perdant emprunte la sortie
      // commune, un second lien invaliderait celui que le gagnant a envoyé.
      try {
        await createLocalAccount({
          email,
          firstname,
          lastname,
          phone,
          passwordHash,
          tokenHash,
          expiresAt: verificationTokenExpiry(),
        });

        dispatchEmail(`activation ${email}`, () =>
          sendActivationEmail({ to: email, firstname, token, next: retour }),
        );
      } catch (error) {
        // Toute autre erreur remonte : une panne de base ne doit pas se déguiser
        // en inscription réussie.
        if (!isPrismaError(error, PRISMA_UNIQUE_VIOLATION)) throw error;
      }
    } else if (!compte.hasCompletedEmailVerification) {
      // Compte en attente d'activation : la soumission vaut demande de renvoi,
      // donc elle passe par le quota. Le cas complémentaire couvre le compte
      // activé ET le compte désactivé par un administrateur, qu'`is_active` ne
      // distingue pas : aucun email, un lien y rouvrirait un compte fermé.
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
        dispatchEmail(`activation ${email}`, () =>
          sendActivationEmail({
            to: email,
            firstname: compte.firstname,
            token,
            next: retour,
          }),
        );
      }
    }

    // **Une seule sortie, pour les trois issues.** Rien de ce qui précède ne
    // peut changer la réponse : ni l'existence du compte, ni le quota, ni le
    // sort de l'envoi (Constitution §4.2). L'échec d'envoi est bruyant côté
    // exploitant seulement, cf. `src/lib/email/dispatch.ts`.
    //
    // `redirect()` hors de tout try/catch, il fonctionne par throw.
    redirect(AFTER_SIGNUP);
  });

type ChampInscription =
  | "firstname"
  | "lastname"
  | "email"
  | "phone"
  | "password"
  | "passwordConfirmation";

/// Ordre du formulaire, et non ordre des clés de l'objet d'erreurs : c'est lui
/// qui décide sur quel champ le focus atterrit (WCAG 3.3.3 AA).
const CHAMPS: readonly ChampInscription[] = [
  "firstname",
  "lastname",
  "email",
  // Renseigné par le seul bloc « Vos coordonnées » de C5. Présent ici pour que
  // son message de validation atteigne le champ, comme les autres.
  "phone",
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

/// Adaptateur `useActionState`, même motif qu'à la connexion
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
    // Clé omise plutôt qu'à `""` : ne pas faire dépendre ce contrat d'un
    // détail de normalisation du schéma.
    ...(champ("phone") === "" ? {} : { phone: champ("phone") }),
    // Champ caché posé par le bloc « Vos coordonnées » de C5, absent de
    // `/inscription`. Il transite par le formulaire, seule voie qui survive à
    // l'absence de JavaScript.
    ...(champ("next") === "" ? {} : { next: champ("next") }),
  });

  // `signup` redirige par throw en cas de succès : ce point n'est atteint que
  // sur un refus.
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

  // Aucun canal `data.error` : l'action n'a qu'une sortie et elle redirige. Ne
  // restent que la panne serveur et la validation, dont aucune ne dépend de
  // l'existence du compte.
  const erreurGlobale =
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
