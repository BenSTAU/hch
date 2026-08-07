"use client";

import { useActionState, useEffect, useRef } from "react";

import { loginFormAction, type LoginFormState } from "@/lib/actions/auth/login";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ETAT_INITIAL: LoginFormState = {};

/// `next` vient du rendu serveur, déjà filtré par `safeNextPath` dans
/// `page.tsx`. Il est renvoyé tel quel à l'action, qui le refiltre — le
/// formulaire n'est pas une frontière de sécurité, il est manipulable.
export function LoginForm({ next }: { next?: string | undefined }) {
  const emailRef = useRef<HTMLInputElement>(null);
  const [state, formAction, isPending] = useActionState(
    loginFormAction,
    ETAT_INITIAL,
  );

  // WCAG 3.3.3 (AA) : le focus revient sur le premier champ après un refus.
  // Sans ça, un utilisateur au clavier ou au lecteur d'écran doit re-parcourir
  // tout le formulaire pour corriger.
  //
  // Dépendance sur `state` et non sur `state.error` : deux refus consécutifs
  // portent le même message — c'est voulu, il est unique — et l'effet ne se
  // rejouerait pas. L'objet d'état, lui, est neuf à chaque soumission.
  useEffect(() => {
    if (state.error) emailRef.current?.focus();
  }, [state]);

  return (
    // `action={formAction}` et non `onSubmit` : le navigateur poste alors le
    // formulaire même si React n'a pas encore hydraté (progressive
    // enhancement). Un `<form>` sans attribut `action` se soumet NATIVEMENT en
    // GET pendant cette fenêtre, tous les champs en query string — mot de
    // passe compris. Cf. `loginFormAction`.
    <form action={formAction} className="flex flex-col gap-4">
      {/* Seule voie pour `next` qui survive à l'absence de JavaScript : une
          prop de composant ne traverse pas une soumission native. */}
      {next === undefined ? null : (
        <input type="hidden" name="next" value={next} />
      )}

      {/* `role="alert"` : le message est annoncé dès son apparition, sans que
          l'utilisateur ait à le chercher (US-COMPTE-CONNECTER §A11y AA). */}
      <p role="alert" className="text-sm text-destructive empty:hidden">
        {state.error}
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Adresse email</Label>
        <Input
          ref={emailRef}
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Mot de passe</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Connexion…" : "Se connecter"}
      </Button>
    </form>
  );
}
