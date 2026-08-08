import Link from "next/link";

import { Card, CardContent, CardHeader } from "@/components/ui/card";

import { AuthSidePanel } from "./auth-side-panel";
import { SignupForm } from "./signup-form";

/// Coquille de la page d'inscription — écran **C6**, vue inscription.
///
/// Même partage qu'à la connexion : la vue est **synchrone**, donc déroulable
/// sous RTL, et le formulaire interactif est la feuille `"use client"`. Un RSC
/// asynchrone ne se déroule pas sous RTL (ADR-014 : async Server Components →
/// E2E uniquement), et les critères de structure de cet écran resteraient alors
/// sans test unitaire.
///
/// Responsive ajouté au portage : les maquettes sont en 1920×1080 seulement, et
/// V3 **est** le parcours client, donc c'est ici que ça se paie
/// ([[adr-012-maquettage-stitch-shadcn|ADR-012]] chiffre le rattrapage à +30 %).
/// Sous `lg`, le panneau vert disparaît et la carte occupe la largeur.
export function InscriptionView() {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <main className="flex flex-1 flex-col justify-center px-4 py-10 sm:px-8">
        <div className="mx-auto w-full max-w-lg">
          {/* Le nom de marque n'apparaît que hors `lg` : au-delà, le panneau
              latéral le porte déjà, et le répéter ferait deux fois le même
              repère pour un lecteur d'écran. */}
          <p className="mb-8 font-heading text-2xl font-bold tracking-tight text-primary lg:hidden">
            HomeCycl&apos;Home
          </p>

          <Card className="[--card-spacing:--spacing(6)]">
            <CardHeader>
              {/* `CardTitle` est un `div` sans `asChild` dans le catalogue
                  shadcn : le titre de page doit être un vrai `h1`, il est donc
                  écrit ici avec les mêmes classes plutôt que passé au slot. */}
              <h1 className="font-heading text-2xl font-bold tracking-tight">
                Créer votre compte
              </h1>
            </CardHeader>

            <CardContent>
              <SignupForm />
            </CardContent>
          </Card>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Vous avez déjà un compte ?{" "}
            <Link
              href="/connexion"
              className="font-medium text-primary underline underline-offset-4"
            >
              Se connecter
            </Link>
          </p>
        </div>
      </main>

      <AuthSidePanel />
    </div>
  );
}
