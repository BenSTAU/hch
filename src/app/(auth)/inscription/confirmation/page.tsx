import type { Metadata } from "next";
import Link from "next/link";

import { SIGNUP_ACKNOWLEDGED_MESSAGE } from "@/lib/validations/auth";

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
export default function ConfirmationInscriptionPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="font-heading text-3xl font-bold">
        Vérifiez votre email pour activer votre compte
      </h1>

      <p className="text-sm text-muted-foreground">
        {SIGNUP_ACKNOWLEDGED_MESSAGE}. Le lien reste valable 24 heures.
      </p>

      <p className="text-sm text-muted-foreground">
        Rien reçu ? Vérifiez vos indésirables, puis demandez un nouvel envoi
        depuis la{" "}
        <Link href="/connexion" className="underline">
          page de connexion
        </Link>
        .
      </p>
    </main>
  );
}
