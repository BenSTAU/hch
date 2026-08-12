"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  signupFormAction,
  type SignupFormState,
} from "@/lib/actions/auth/signup";
import { BasculeMotDePasse } from "@/components/features/auth/bascule-mot-de-passe";
import { GdprNotice } from "@/components/features/auth/gdpr-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ETAT_INITIAL: SignupFormState = {};

const CHAMPS = [
  "firstname",
  "lastname",
  "email",
  "password",
  "passwordConfirmation",
] as const;

type Champ = (typeof CHAMPS)[number];

/// Règles annoncées AVANT la soumission et associées au champ — WCAG 3.3.2 (AA),
/// exigé mot pour mot par `US-COMPTE-CREER` §Accessibilité. Un message qui
/// n'apparaît qu'après l'échec fait deviner la règle. Libellé repris de la
/// maquette **C6**.
const AIDE_MOT_DE_PASSE = "12 caractères minimum requis.";

function idErreur(champ: Champ): string {
  return `${champ}-error`;
}

/// `undefined` et non `""` quand il n'y a rien à décrire : un `aria-describedby`
/// vide est un IDREF invalide, que les lecteurs d'écran traitent diversement.
function decritPar(
  ...ids: Array<string | false | undefined>
): string | undefined {
  const retenus = ids.filter((id): id is string => typeof id === "string");
  return retenus.length > 0 ? retenus.join(" ") : undefined;
}

/// L'astérisque vit HORS du `<label>`, et il est `aria-hidden`.
///
/// Deux raisons. L'obligation est déjà portée par l'attribut `required`, que les
/// technologies d'assistance annoncent — la répéter en texte la dirait deux fois.
/// Et un astérisque à l'intérieur du label entrerait dans le nom accessible du
/// champ, qui deviendrait « Adresse email * ».
function Obligatoire() {
  return (
    <span aria-hidden="true" className="text-destructive">
      *
    </span>
  );
}

export function SignupForm() {
  const [state, formAction, isPending] = useActionState(
    signupFormAction,
    ETAT_INITIAL,
  );
  const [motDePasseVisible, setMotDePasseVisible] = useState(false);

  // Cinq refs distinctes et non un dictionnaire de refs : lire `refs[champ]`
  // pendant le rendu déclenche `react-hooks/refs`, et la règle a raison sur le
  // fond — la résolution appartient à l'effet, pas au rendu.
  const firstnameRef = useRef<HTMLInputElement>(null);
  const lastnameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const passwordConfirmationRef = useRef<HTMLInputElement>(null);

  const erreurs = state.fieldErrors ?? {};

  // WCAG 3.3.3 (AA) : le focus part sur le PREMIER champ fautif, dans l'ordre du
  // formulaire et non dans l'ordre des clés de l'objet d'erreurs. Sans ça, un
  // utilisateur au clavier doit re-parcourir cinq champs pour trouver lequel
  // coince.
  //
  // Dépendance sur `state` et non sur ses champs : deux refus consécutifs
  // peuvent porter les mêmes messages, et l'effet ne se rejouerait pas. L'objet
  // d'état, lui, est neuf à chaque soumission.
  useEffect(() => {
    const champs: Record<Champ, HTMLInputElement | null> = {
      firstname: firstnameRef.current,
      lastname: lastnameRef.current,
      email: emailRef.current,
      password: passwordRef.current,
      passwordConfirmation: passwordConfirmationRef.current,
    };

    const premier = CHAMPS.find((champ) => state.fieldErrors?.[champ]);
    if (premier) champs[premier]?.focus();
    else if (state.error) emailRef.current?.focus();
  }, [state]);

  const resume =
    state.error ??
    (Object.keys(erreurs).length > 0
      ? "Le formulaire comporte des erreurs."
      : "");

  return (
    // `action={formAction}` et non `onSubmit` : le navigateur poste alors le
    // formulaire même si React n'a pas encore hydraté. Un `<form>` sans attribut
    // `action` se soumet NATIVEMENT en GET pendant cette fenêtre — tous les
    // champs en query string, mots de passe compris, donc dans l'historique, les
    // journaux nginx et le `Referer`. Leçon T-J0-04.
    <form action={formAction} className="flex flex-col gap-5">
      {/* `role="alert"` : annoncé dès son apparition, sans que l'utilisateur ait
          à le chercher. Un seul de ces repères sur l'écran — les messages par
          champ sont liés par `aria-describedby`, pas dupliqués en alertes. */}
      <p
        role="alert"
        className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive empty:hidden"
      >
        {resume}
      </p>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1">
            <Label htmlFor="firstname">Prénom</Label>
            <Obligatoire />
          </div>
          <Input
            ref={firstnameRef}
            id="firstname"
            name="firstname"
            autoComplete="given-name"
            defaultValue={state.values?.firstname ?? ""}
            aria-invalid={erreurs.firstname ? true : undefined}
            aria-describedby={decritPar(
              erreurs.firstname && idErreur("firstname"),
            )}
            required
          />
          <p
            id={idErreur("firstname")}
            className="text-sm text-destructive empty:hidden"
          >
            {erreurs.firstname ?? ""}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1">
            <Label htmlFor="lastname">Nom</Label>
            <Obligatoire />
          </div>
          <Input
            ref={lastnameRef}
            id="lastname"
            name="lastname"
            autoComplete="family-name"
            defaultValue={state.values?.lastname ?? ""}
            aria-invalid={erreurs.lastname ? true : undefined}
            aria-describedby={decritPar(
              erreurs.lastname && idErreur("lastname"),
            )}
            required
          />
          <p
            id={idErreur("lastname")}
            className="text-sm text-destructive empty:hidden"
          >
            {erreurs.lastname ?? ""}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1">
          <Label htmlFor="email">Adresse email</Label>
          <Obligatoire />
        </div>
        <Input
          ref={emailRef}
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state.values?.email ?? ""}
          aria-invalid={erreurs.email ? true : undefined}
          aria-describedby={decritPar(
            "email-hint",
            erreurs.email && idErreur("email"),
          )}
          required
        />
        <p id="email-hint" className="text-sm text-muted-foreground">
          Un lien d&apos;activation vous sera envoyé.
        </p>
        <p
          id={idErreur("email")}
          className="text-sm text-destructive empty:hidden"
        >
          {erreurs.email ?? ""}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1">
          <Label htmlFor="password">Mot de passe</Label>
          <Obligatoire />
        </div>
        <div className="relative">
          <Input
            ref={passwordRef}
            id="password"
            name="password"
            type={motDePasseVisible ? "text" : "password"}
            // `new-password` et non `current-password` : c'est ce qui fait
            // proposer un mot de passe fort au gestionnaire, au lieu de remplir
            // celui d'un autre compte.
            autoComplete="new-password"
            className="pr-10"
            aria-invalid={erreurs.password ? true : undefined}
            aria-describedby={decritPar(
              "password-hint",
              erreurs.password && idErreur("password"),
            )}
            required
          />
          <BasculeMotDePasse
            visible={motDePasseVisible}
            onBascule={() => {
              setMotDePasseVisible((visible) => !visible);
            }}
            controle="password"
          />
        </div>
        <p id="password-hint" className="text-sm text-muted-foreground">
          {AIDE_MOT_DE_PASSE}
        </p>
        <p
          id={idErreur("password")}
          className="text-sm text-destructive empty:hidden"
        >
          {erreurs.password ?? ""}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1">
          <Label htmlFor="passwordConfirmation">
            Confirmer le mot de passe
          </Label>
          <Obligatoire />
        </div>
        <Input
          ref={passwordConfirmationRef}
          id="passwordConfirmation"
          name="passwordConfirmation"
          type="password"
          autoComplete="new-password"
          aria-invalid={erreurs.passwordConfirmation ? true : undefined}
          aria-describedby={decritPar(
            erreurs.passwordConfirmation && idErreur("passwordConfirmation"),
          )}
          required
        />
        <p
          id={idErreur("passwordConfirmation")}
          className="text-sm text-destructive empty:hidden"
        >
          {erreurs.passwordConfirmation ?? ""}
        </p>
      </div>

      <Button type="submit" disabled={isPending} className="h-11 w-full">
        {isPending ? "Création…" : "Créer mon compte"}
      </Button>

      {/* Mention RGPD au point de collecte — article 13, PLAN S4 §4.3. Le
          rationale complet, dont le remplacement de la case « J'accepte les
          CGV », vit dans le composant. */}
      <GdprNotice finalite="créer et gérer votre compte HomeCycl'Home" />
    </form>
  );
}
