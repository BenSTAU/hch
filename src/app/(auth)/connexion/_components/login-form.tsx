"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import { loginFormAction, type LoginFormState } from "@/lib/actions/auth/login";
import { BasculeMotDePasse } from "@/components/features/auth/bascule-mot-de-passe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ETAT_INITIAL: LoginFormState = {};

/// `next` vient du rendu serveur, déjà filtré par `safeNextPath` dans
/// `page.tsx`. Il est renvoyé tel quel à l'action, qui le refiltre - le
/// formulaire n'est pas une frontière de sécurité, il est manipulable.
export function LoginForm({ next }: { next?: string | undefined }) {
  const emailRef = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);
  const [state, formAction, isPending] = useActionState(
    loginFormAction,
    ETAT_INITIAL,
  );

  // WCAG 3.3.3 (AA) : le focus revient sur le premier champ après un refus.
  // Sans ça, un utilisateur au clavier ou au lecteur d'écran doit re-parcourir
  // tout le formulaire pour corriger.
  //
  // Dépendance sur `state` et non sur `state.error` : deux refus consécutifs
  // portent le même message - c'est voulu, il est unique - et l'effet ne se
  // rejouerait pas. L'objet d'état, lui, est neuf à chaque soumission.
  useEffect(() => {
    if (state.error) emailRef.current?.focus();
  }, [state]);

  return (
    // `action={formAction}` et non `onSubmit` : le navigateur poste alors le
    // formulaire même si React n'a pas encore hydraté (progressive
    // enhancement). Un `<form>` sans attribut `action` se soumet NATIVEMENT en
    // GET pendant cette fenêtre, tous les champs en query string - mot de
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
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={visible ? "text" : "password"}
            autoComplete="current-password"
            className="pr-11"
            required
          />
          {/* Bascule de la maquette C6, conservée au portage : sur mobile, une
              faute de frappe invisible est le premier motif d'échec. */}
          <BasculeMotDePasse
            visible={visible}
            onBascule={() => {
              setVisible((etat) => !etat);
            }}
            controle="password"
            className="rounded-xl"
          />
        </div>
      </div>

      {/* La maquette pose « Se souvenir de moi » et « Mot de passe oublié ? »
          côte à côte, écrasés l'un contre l'autre - divergence recensée dans
          [[maquettage]] §Notes portage §C6. La case n'est pas portée : aucun
          critère d'acceptation ne la prescrit et ADR-005 v2 fixe la session à
          7 jours fermes, elle ne commanderait donc rien.

          Le lien, lui, est exigé nommément par US-COMPTE-CONNECTER
          §Accessibilité AA (WCAG 2.4.6) et il est l'unique entrée du parcours
          de réinitialisation. La page arrive avec T-V3-05 - d'ici là le lien
          mène à un 404, même précédent que la mention RGPD de T-V3-02. */}
      <div className="flex justify-end">
        <Link
          href="/mot-de-passe-oublie"
          className="text-sm font-medium text-primary underline underline-offset-4"
        >
          Mot de passe oublié ?
        </Link>
      </div>

      {/* « formulaire bloqué en front ET serveur » (§Cas d'erreur). Le serveur
          refuse dans tous les cas ; ceci évite de laisser marteler un bouton
          qui ne peut plus rien produire pendant les 10 minutes du verrou. */}
      <Button type="submit" disabled={isPending || state.blocked === true}>
        {isPending ? "Connexion…" : "Se connecter"}
      </Button>

      {/* Sortie de l'écran bloqué, constat E5 de l'agent testeur : le bouton
          désactivé était le SEUL déclencheur d'un nouvel état, si bien que le
          message qui invite à réessayer n'avait aucun geste possible derrière
          lui.

          Une balise `<a>` et non `<Link>` : la navigation client de Next ne
          remonte pas ce composant vers la même route, l'état d'action
          survivrait et le bouton resterait fermé. Il faut une vraie requête.
          `next` est reconduit pour ne pas perdre la destination demandée. */}
      {state.blocked === true ? (
        <p className="text-center text-sm text-muted-foreground">
          <a
            href={
              next === undefined
                ? "/connexion"
                : `/connexion?next=${encodeURIComponent(next)}`
            }
            className="font-medium text-primary underline underline-offset-4"
          >
            Recharger le formulaire
          </a>{" "}
          pour réessayer.
        </p>
      ) : null}
    </form>
  );
}
