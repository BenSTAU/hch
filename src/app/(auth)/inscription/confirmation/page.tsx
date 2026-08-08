import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";

import { SIGNUP_ACKNOWLEDGED_MESSAGE } from "@/lib/validations/auth";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Vérifiez votre email — HomeCycl'Home",
};

/// Écran de sortie **unique** des trois issues de l'inscription — email libre,
/// compte existant non activé, compte existant déjà activé.
///
/// La SPEC en décrit deux (« Vérifiez votre email » au nominal,
/// module-1-utilisateurs.md:160 ; le message générique sur email déjà pris,
/// :165). Deux écrans distincts suffiraient à énumérer les comptes : il suffit
/// de soumettre une adresse pour savoir si elle en a un. Cet écran porte donc les
/// deux formulations, et il est le même dans les trois cas. Écart déclaré dans le
/// body de PR.
///
/// Repris de la maquette **C9** : même bandeau, même carte, même pastille
/// d'icône que les états d'activation, dont il est la porte d'entrée.
export default function ConfirmationInscriptionPage() {
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
          <h1 className="mb-8 text-3xl">
            Vérifiez votre email pour activer votre compte
          </h1>

          <Card className="[--card-spacing:--spacing(6)]">
            <CardHeader>
              <div className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-fixed text-accent-foreground">
                  <MailCheck aria-hidden="true" className="size-5" />
                </span>
                <p className="text-sm">
                  {SIGNUP_ACKNOWLEDGED_MESSAGE}. Le lien reste valable{" "}
                  <strong>24 heures</strong>.
                </p>
              </div>
            </CardHeader>

            <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
              <p>
                Rien reçu ? Vérifiez vos indésirables, puis demandez un nouvel
                envoi depuis le lien d&apos;activation expiré ou la page de
                connexion.
              </p>
              <Link
                href="/connexion"
                className="font-medium text-primary underline underline-offset-4"
              >
                Aller à la page de connexion
              </Link>
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
