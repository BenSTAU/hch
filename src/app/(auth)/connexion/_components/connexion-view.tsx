import Link from "next/link";

import { AuthSidePanel } from "@/components/features/auth/auth-side-panel";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

import { LoginForm } from "./login-form";

/// Coquille de la page de connexion — écran **C6**, vue 2.
///
/// Ce composant-ci est **synchrone**, donc déroulable sous RTL, et porte tout ce
/// que les tests de structure observent. La page, elle, doit être asynchrone
/// pour lire `searchParams` — Next 16 la type `Promise` — et un RSC asynchrone
/// ne se déroule pas sous RTL (ADR-014 : async Server Components → E2E
/// uniquement).
///
/// Même forme que l'inscription : carte à gauche, panneau vert à droite qui
/// passe à gauche par `order` à partir de `lg` et disparaît en dessous. Le
/// formulaire vient en PREMIER dans le document — c'est ce que la personne est
/// venue faire, et c'est ce qui donne l'ordre de tabulation et la hiérarchie de
/// titres (H1 du formulaire avant H2 du panneau).
export function ConnexionView({
  next,
  activated = false,
}: {
  next?: string | undefined;
  activated?: boolean;
}) {
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
                Connexion
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Accédez à votre espace HomeCycl&apos;Home.
              </p>
            </CardHeader>

            <CardContent className="flex flex-col gap-6">
              {/* Destination de la redirection d'activation (T-V3-02,
                  `US-COMPTE-ACTIVER` §Cas nominal : « redirigé vers la page de
                  connexion avec message “Compte activé, vous pouvez vous
                  connecter” »). `role="status"` et non `alert` : le repère
                  `alert` de cet écran appartient au refus de connexion, et deux
                  le rendraient ambigu. */}
              <p
                role="status"
                className="rounded-xl bg-primary-fixed px-3 py-2 text-sm text-accent-foreground empty:hidden"
              >
                {activated ? "Compte activé, vous pouvez vous connecter." : ""}
              </p>

              <LoginForm next={next} />
            </CardContent>
          </Card>

          {/* Point d'entrée du renvoi d'activation — `US-COMPTE-CONNECTER`
              §Cas d'erreur : « un bouton “Renvoyer un email d'activation” est
              présent en dessous du formulaire ». L'action et le formulaire
              vivent sur l'écran C9 (T-V3-02) ; c'est le chemin pour y aller qui
              manquait, et sans lui un compte non activé dont le lien a expiré
              n'a aucun recours. */}
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Vous n&apos;avez pas reçu votre email d&apos;activation ?{" "}
            <Link
              href="/activation?renvoi=1"
              className="font-medium text-primary underline underline-offset-4"
            >
              Renvoyer un email d&apos;activation
            </Link>
          </p>

          <p className="mt-2 text-center text-sm text-muted-foreground">
            Pas encore de compte ?{" "}
            <Link
              href="/inscription"
              className="font-medium text-primary underline underline-offset-4"
            >
              Créer un compte
            </Link>
          </p>
        </div>
      </main>

      <AuthSidePanel />
    </div>
  );
}
