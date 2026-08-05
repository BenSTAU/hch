import type { Metadata } from "next";

import { LoginForm } from "./_components/login-form";

export const metadata: Metadata = {
  title: "Connexion — HomeCycl'Home",
};

// Server Component : la page ne porte aucun état. Seul le formulaire est
// client, et la frontière `"use client"` descend jusqu'à lui — pas au layout.
export default function ConnexionPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-bold">Connexion</h1>
        <p className="text-sm text-muted-foreground">
          Accédez à votre espace HomeCycl&apos;Home.
        </p>
      </div>

      <LoginForm />
    </main>
  );
}
