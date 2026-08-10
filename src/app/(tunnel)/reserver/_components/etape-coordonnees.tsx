"use client";

import Link from "next/link";
import { useActionState } from "react";

import { GdprNotice } from "@/components/features/auth/gdpr-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  signupFormAction,
  type SignupFormState,
} from "@/lib/actions/auth/signup";

/// Bloc « Vos coordonnées » de l'écran **C5** — qui **est** le formulaire
/// d'inscription (PLAN S4 §4.3, aligné le 2026-08-09).
///
/// Le tunnel s'explore sans compte, mais la validation en exige un créé,
/// activé et connecté (Constitution §3.2). C'est ici que le visiteur bascule.
///
/// **Deux branches, et la seconde n'est pas un confort** : `users.email` est
/// unique, donc un client déjà inscrit qui n'aurait que « Créer mon compte »
/// se heurterait à un refus sans issue.
///
/// La case « J'accepte les CGV » de la maquette **n'est pas portée** : elle
/// suppose une page hors périmètre v1. La mention RGPD la remplace, même
/// traitement que C6.
///
/// ── Géométrie portée (`c5:259-284`)
///
///   · dalle du bento de gauche, titre `headline-sm` et sous-titre `body-sm` ;
///   · formulaire en `grid md:grid-cols-2`, gouttières `gap-x-4 gap-y-6`.
///
/// La maquette écrit « Vous pourrez créer un compte à l'issue de la
/// réservation » (`c5:263`). Le renversement de Constitution §3.2 du
/// 2026-08-09 inverse la phrase : le compte activé précède la validation.

const ETAT_INITIAL: SignupFormState = {};

/// Le mot de passe et sa confirmation ne figurent pas sur la maquette, qui
/// n'affiche que quatre champs. Ils sont ajoutés parce que `US-COMPTE-CREER`
/// les exige : c'est la maquette qui est en retard sur l'US, pas l'inverse.
export function EtapeCoordonnees({ retour }: { retour: string }) {
  // `signupFormAction` REDIRIGE en cas de succès, vers l'écran « Vérifiez votre
  // email ». Ce composant n'a donc pas d'état de réussite à rendre : il ne voit
  // que les refus.
  //
  // `retour` sert aux DEUX branches depuis le 2026-08-10 : la connexion d'un
  // client déjà inscrit, qui reste dans le même onglet, et l'inscription, dont
  // la destination voyage maintenant dans le lien d'activation.
  const [state, formAction, isPending] = useActionState(
    signupFormAction,
    ETAT_INITIAL,
  );

  const erreurs = state.fieldErrors ?? {};

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-xl font-bold tracking-[-0.01em]">
          Vos coordonnées
        </h2>
        <p className="text-sm leading-[1.5] text-muted-foreground">
          La validation demande un compte activé. Créez-le ici : votre sélection
          reste en place, et vous revenez au récapitulatif.
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-6">
        {/* La destination de retour voyage jusque dans le lien d'activation,
            puis jusqu'à la page de connexion. C'est ce qui referme la DoD
            « l'activation ramène au tunnel » d'`US-COMPTE-ACTIVER`, orpheline
            depuis T-V3-02.
            ⚠️ Ce qui revient est l'INTENTION, pas la sélection : le lien
            s'ouvre souvent sur un autre appareil, où `sessionStorage` n'existe
            pas. Le tunnel affiche alors son écran de reprise, qui dit la
            limite au lieu de rendre une page blanche.
            Champ caché plutôt que paramètre d'URL : c'est la seule voie qui
            survive à l'absence de JavaScript. `safeNextPath` arbitre côté
            action, comme à la connexion. */}
        <input type="hidden" name="next" value={retour} />

        <p
          role="alert"
          className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive empty:hidden"
        >
          {state.error ?? ""}
        </p>

        <div className="grid gap-x-4 gap-y-6 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="c5-firstname">Prénom</Label>
            <Input
              id="c5-firstname"
              name="firstname"
              autoComplete="given-name"
              defaultValue={state.values?.firstname ?? ""}
              aria-invalid={erreurs.firstname ? true : undefined}
              required
            />
            <p className="text-sm text-destructive empty:hidden">
              {erreurs.firstname ?? ""}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="c5-lastname">Nom</Label>
            <Input
              id="c5-lastname"
              name="lastname"
              autoComplete="family-name"
              defaultValue={state.values?.lastname ?? ""}
              aria-invalid={erreurs.lastname ? true : undefined}
              required
            />
            <p className="text-sm text-destructive empty:hidden">
              {erreurs.lastname ?? ""}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="c5-email">Adresse email</Label>
          <Input
            id="c5-email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={state.values?.email ?? ""}
            aria-invalid={erreurs.email ? true : undefined}
            required
          />
          <p className="text-sm text-destructive empty:hidden">
            {erreurs.email ?? ""}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="c5-phone">Téléphone</Label>
          <Input
            id="c5-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="06 12 34 56 78"
            aria-describedby="c5-phone-hint"
            aria-invalid={erreurs.phone ? true : undefined}
          />
          <p id="c5-phone-hint" className="text-sm text-muted-foreground">
            Facultatif. Le technicien s&apos;en sert pour vous prévenir de son
            arrivée.
          </p>
          <p className="text-sm text-destructive empty:hidden">
            {erreurs.phone ?? ""}
          </p>
        </div>

        <div className="grid gap-x-4 gap-y-6 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="c5-password">Mot de passe</Label>
            <Input
              id="c5-password"
              name="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={erreurs.password ? true : undefined}
              required
            />
            <p className="text-sm text-destructive empty:hidden">
              {erreurs.password ?? ""}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="c5-password-confirmation">
              Confirmer le mot de passe
            </Label>
            <Input
              id="c5-password-confirmation"
              name="passwordConfirmation"
              type="password"
              autoComplete="new-password"
              aria-invalid={erreurs.passwordConfirmation ? true : undefined}
              required
            />
            <p className="text-sm text-destructive empty:hidden">
              {erreurs.passwordConfirmation ?? ""}
            </p>
          </div>
        </div>

        <Button
          type="submit"
          disabled={isPending}
          className="h-auto w-full rounded-xl px-6 py-3 text-sm font-semibold tracking-[0.05em]"
        >
          {isPending ? "Création…" : "Créer mon compte"}
        </Button>

        <GdprNotice finalite="créer votre compte et exécuter votre réservation" />
      </form>

      <p className="text-sm">
        Déjà client ?{" "}
        <Link
          href={`/connexion?next=${encodeURIComponent(retour)}`}
          className="underline underline-offset-4"
        >
          J&apos;ai déjà un compte
        </Link>
      </p>
    </section>
  );
}
