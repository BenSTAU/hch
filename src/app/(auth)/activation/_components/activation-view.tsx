"use client";

import Link from "next/link";
import { CircleAlert, CircleCheck, Clock, Mail } from "lucide-react";
import { useActionState } from "react";

import {
  activateFormAction,
  resendActivationFormAction,
  type ActivationFormState,
  type ResendFormState,
} from "@/lib/actions/auth/activate";
import { SIGNUP_ACKNOWLEDGED_MESSAGE } from "@/lib/validations/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/// Écran d'activation — maquette **C9**, `US-COMPTE-ACTIVER`.
///
/// La maquette est un CATALOGUE : elle montre les quatre états côte à côte sur
/// une même page, sous le titre « Gestion de l'accès ». L'écran réel n'en porte
/// qu'un à la fois — c'est un état de la même page, pas quatre cartes.
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
/// (module-1-utilisateurs.md:211), assumé et signalé dans le body de PR.
///
/// La frontière `"use client"` couvre l'écran entier parce que l'écran entier
/// est interactif — ce n'est pas un layout, c'est le contenu de la page.

const ACTIVATION_INITIALE: ActivationFormState = {};
const RENVOI_INITIAL: ResendFormState = {};

type Issue = NonNullable<ActivationFormState["outcome"]>;

/// Un état = un titre, un texte, une icône, une teinte. Les trois teintes sont
/// celles de la palette « Kinetic Urbanist » (ADR-012 §D4) : `primary-fixed`
/// pour le succès, `tertiary-fixed` pour l'attente, `destructive` pour l'échec.
///
/// La maquette pose l'alerte du lien invalide en rose `destructive-container` ;
/// on garde `destructive` du vocabulaire shadcn, comme partout ailleurs.
const ETATS: Record<
  Issue,
  { titre: string; texte: string; icone: typeof Clock; teinte: string }
> = {
  expired: {
    titre: "Lien expiré",
    texte:
      "Pour des raisons de sécurité, ce lien d'activation a expiré après 24 heures.",
    icone: Clock,
    teinte: "bg-tertiary-fixed text-tertiary-fixed-foreground",
  },
  already_used: {
    titre: "Compte déjà activé",
    texte:
      "Ce compte a déjà été vérifié. Vous pouvez accéder à votre espace personnel.",
    icone: CircleCheck,
    teinte: "bg-primary-fixed text-accent-foreground",
  },
  invalid: {
    titre: "Lien invalide",
    texte: "Ce lien est incomplet ou ne correspond à aucune demande en cours.",
    icone: CircleAlert,
    teinte: "bg-destructive/15 text-destructive",
  },
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
  const issue: Issue | undefined =
    token === undefined ? "invalid" : etat.outcome;
  const affiche = issue ? ETATS[issue] : undefined;
  const Icone = affiche?.icone ?? Mail;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between border-b px-4 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="font-heading text-lg font-bold tracking-tight text-primary">
            HomeCycl&apos;Home
          </span>
          <span className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
            Activation compte
          </span>
        </div>
        <Link
          href="/"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          Retour à l&apos;accueil
        </Link>
      </header>

      <main className="flex flex-1 flex-col justify-center px-4 py-10 sm:px-8">
        <div className="mx-auto w-full max-w-xl">
          <h1 className="mb-8 text-3xl">Activation de votre compte</h1>

          <Card className="[--card-spacing:--spacing(6)]">
            <CardHeader>
              <div className="flex gap-4">
                <span
                  className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
                    affiche?.teinte ?? "bg-primary-fixed text-accent-foreground"
                  }`}
                >
                  <Icone aria-hidden="true" className="size-5" />
                </span>
                {/* La région live porte le TITRE **et** le texte, pas le seul
                    texte : c'est le titre qui nomme l'issue — « Lien expiré »,
                    « Compte déjà activé » — et une annonce qui l'omettrait ne
                    dirait pas ce qui vient de se passer.
                    Repère unique de l'écran ; les messages du renvoi passent par
                    `role="status"` plus bas, deux `alert` rendraient les deux
                    ambigus. */}
                <div role="alert">
                  <h2 className="font-heading text-lg font-bold">
                    {affiche?.titre ?? "Confirmez votre activation"}
                  </h2>
                  <p className="mt-1 text-sm">
                    {etat.error ??
                      affiche?.texte ??
                      "Un dernier geste : validez pour activer votre compte."}
                  </p>
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex flex-col gap-4">
              {token !== undefined && issue === undefined ? (
                <form action={activer}>
                  {/* Seule voie pour le jeton qui survive à l'absence de
                      JavaScript : une prop de composant ne traverse pas une
                      soumission native. */}
                  <input type="hidden" name="token" value={token} />
                  <Button
                    type="submit"
                    disabled={activationEnCours}
                    className="h-11 w-full"
                  >
                    {activationEnCours ? "Activation…" : "Activer mon compte"}
                  </Button>
                </form>
              ) : null}

              {issue === "expired" ? (
                <form action={renvoyer} className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2">
                    {/* L'adresse est DEMANDÉE, pas déduite du jeton expiré : le
                        porteur du lien n'est pas forcément le titulaire de la
                        boîte — lien transféré, boîte partagée. La maquette
                        l'affiche pré-remplie, c'est une divergence de portage. */}
                    <Label htmlFor="email">Adresse email</Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={renvoiEnCours}
                    className="h-11 w-full"
                  >
                    {renvoiEnCours
                      ? "Envoi…"
                      : "Renvoyer un email d'activation"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Limite d&apos;envoi : 3 demandes par 24 h.
                  </p>
                </form>
              ) : null}

              <p
                role="status"
                className="rounded-xl bg-secondary px-3 py-2 text-sm empty:hidden"
              >
                {renvoi.error ??
                  (renvoi.sent
                    ? `${SIGNUP_ACKNOWLEDGED_MESSAGE}. Le lien reste valable 24 heures.`
                    : "")}
              </p>

              {issue === "already_used" || issue === "expired" ? (
                <Link
                  href="/connexion"
                  className="text-center text-sm font-medium text-primary underline underline-offset-4"
                >
                  Se connecter
                </Link>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </main>

      {/* © 2026 et non 2024 : règle de portage globale de [[maquettage]]
          §Notes portage. */}
      <footer className="border-t px-4 py-6 text-center text-xs text-muted-foreground sm:px-8">
        © 2026 HomeCycl&apos;Home Lyon. Tous droits réservés.
      </footer>
    </div>
  );
}
