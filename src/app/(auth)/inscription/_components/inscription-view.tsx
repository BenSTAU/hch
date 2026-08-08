import Link from "next/link";

import { SignupForm } from "./signup-form";

/// Coquille de la page d'inscription — écran C6, vue inscription.
///
/// Même partage qu'à la connexion : la vue est **synchrone**, donc déroulable
/// sous RTL, et le formulaire interactif est la feuille `"use client"`. Un RSC
/// asynchrone ne se déroule pas sous RTL (ADR-014 : async Server Components →
/// E2E uniquement), et les critères de structure de cet écran resteraient alors
/// sans test unitaire.
export function InscriptionView() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-bold">Créer un compte</h1>
        <p className="text-sm text-muted-foreground">
          Suivez vos rendez-vous et retrouvez vos réservations passées.
        </p>
      </div>

      <SignupForm />

      <p className="text-sm text-muted-foreground">
        Vous avez déjà un compte ?{" "}
        <Link href="/connexion" className="underline">
          Se connecter
        </Link>
      </p>
    </main>
  );
}
