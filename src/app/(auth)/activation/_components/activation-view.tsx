"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  activateFormAction,
  resendActivationFormAction,
  type ActivationFormState,
  type ResendFormState,
} from "@/lib/actions/auth/activate";
import { SIGNUP_ACKNOWLEDGED_MESSAGE } from "@/lib/validations/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/// Écran d'activation — maquette C9, `US-COMPTE-ACTIVER`.
///
/// **Le lien ne consomme pas le jeton** : il mène ici, et c'est le bouton qui
/// poste. Deux raisons, dont une seule est une règle du dépôt. La règle :
/// CLAUDE.md réserve les Route Handlers à trois cas dont l'activation ne fait pas
/// partie, exige les mutations en Server Action, et interdit d'appeler une Server
/// Action depuis un Server Component. Le fait : les webmails préchargent les
/// liens qu'ils reçoivent, et un jeton consommé par un robot laisse un compte
/// inactivable — l'échec arrive alors chez le client, sans recours.
///
/// Écart au G/W/T de la SPEC, qui décrit un seul clic
/// (module-1-utilisateurs.md:211). Déclaré dans le body de PR.
///
/// La frontière `"use client"` couvre l'écran entier parce que l'écran entier est
/// interactif — ce n'est pas un layout, c'est le contenu de la page.

const ACTIVATION_INITIALE: ActivationFormState = {};
const RENVOI_INITIAL: ResendFormState = {};

const MESSAGES: Record<NonNullable<ActivationFormState["outcome"]>, string> = {
  expired: "Lien expiré. Demandez un nouvel email d'activation.",
  already_used: "Compte déjà activé, connectez-vous.",
  invalid: "Lien invalide.",
};

export function ActivationView({ token }: { token?: string | undefined }) {
  const [etat, activer, activationEnCours] = useActionState(
    activateFormAction,
    ACTIVATION_INITIALE,
  );
  const [renvoi, renvoyer, renvoiEnCours] = useActionState(
    resendActivationFormAction,
    RENVOI_INITIAL,
  );

  // Un lien tronqué par un client de messagerie arrive ici sans jeton. Ce n'est
  // pas un cas d'attaque, mais le message reste générique : pas d'énumération
  // des jetons valides (SPEC §Cas d'erreur).
  const issue = token === undefined ? "invalid" : etat.outcome;
  const message = etat.error ?? (issue ? MESSAGES[issue] : "");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="font-heading text-3xl font-bold">
        Activation de votre compte
      </h1>

      <p role="alert" className="text-sm empty:hidden">
        {message}
      </p>

      {token !== undefined && issue === undefined ? (
        <form action={activer} className="flex flex-col gap-4">
          {/* Seule voie qui survive à l'absence de JavaScript : une prop de
              composant ne traverse pas une soumission native. */}
          <input type="hidden" name="token" value={token} />
          <Button type="submit" disabled={activationEnCours}>
            {activationEnCours ? "Activation…" : "Activer mon compte"}
          </Button>
        </form>
      ) : null}

      {issue === "expired" ? (
        <form action={renvoyer} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            {/* L'adresse est DEMANDÉE, pas déduite du jeton expiré : le porteur
                du lien n'est pas forcément le titulaire de la boîte — lien
                transféré, boîte partagée. */}
            <Label htmlFor="email">Adresse email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </div>
          <Button type="submit" disabled={renvoiEnCours}>
            {renvoiEnCours ? "Envoi…" : "Renvoyer un email d'activation"}
          </Button>
        </form>
      ) : null}

      {/* Une seule région pour le retour du renvoi, succès comme échec. Un
          second `role="alert"` sur l'écran rendrait les deux repères ambigus,
          pour un état que l'utilisateur vient de déclencher et dont le focus
          est à côté. */}
      <p role="status" className="text-sm empty:hidden">
        {renvoi.error ??
          (renvoi.sent
            ? `${SIGNUP_ACKNOWLEDGED_MESSAGE}. Le lien reste valable 24 heures.`
            : "")}
      </p>

      {issue === "already_used" || issue === "expired" ? (
        <p className="text-sm text-muted-foreground">
          <Link href="/connexion" className="underline">
            Se connecter
          </Link>
        </p>
      ) : null}
    </main>
  );
}
