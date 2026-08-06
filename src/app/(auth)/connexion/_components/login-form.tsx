"use client";

import { useAction } from "next-safe-action/hooks";
import { useEffect, useRef } from "react";

import { login } from "@/lib/actions/auth/login";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/// `next` vient du rendu serveur, déjà filtré par `safeNextPath` dans
/// `page.tsx`. Il est renvoyé tel quel à l'action, qui le refiltre — le
/// formulaire n'est pas une frontière de sécurité, il est manipulable.
export function LoginForm({ next }: { next?: string | undefined }) {
  const emailRef = useRef<HTMLInputElement>(null);
  const { execute, result, isPending } = useAction(login);

  const message =
    result.data?.error ??
    result.serverError ??
    (result.validationErrors
      ? "Vérifiez les champs du formulaire."
      : undefined);

  // WCAG 3.3.3 (AA) : le focus revient sur le premier champ après un refus.
  // Sans ça, un utilisateur au clavier ou au lecteur d'écran doit re-parcourir
  // tout le formulaire pour corriger.
  useEffect(() => {
    if (message) emailRef.current?.focus();
  }, [message]);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        execute({
          email: String(data.get("email") ?? ""),
          password: String(data.get("password") ?? ""),
          // Omis plutôt que transmis à `undefined` : le schéma le rend
          // facultatif, une clé présente et vide n'aurait pas le même sens.
          ...(next === undefined ? {} : { next }),
        });
      }}
    >
      {/* `role="alert"` : le message est annoncé dès son apparition, sans que
          l'utilisateur ait à le chercher (US-COMPTE-CONNECTER §A11y AA). */}
      <p role="alert" className="text-sm text-destructive empty:hidden">
        {message}
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
