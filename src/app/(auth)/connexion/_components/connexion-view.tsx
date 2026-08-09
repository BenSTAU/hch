import { LoginForm } from "./login-form";

/// Coquille de la page de connexion, extraite de `page.tsx` en T-J0-05.
///
/// Raison : la page doit lire `searchParams` pour consommer le `next=` produit
/// par `src/proxy.ts`, et Next 16 type `searchParams` en `Promise` — la page
/// devient donc async, et un RSC asynchrone ne se déroule pas sous RTL
/// (ADR-014 : *async Server Components → E2E uniquement*). Les critères
/// d'accessibilité de cet écran — repère principal, hiérarchie de titres —
/// resteraient sans test unitaire.
///
/// Ce composant-ci est **synchrone**, donc testable, et porte tout ce que ces
/// tests observaient.
export function ConnexionView({
  next,
  activated = false,
}: {
  next?: string | undefined;
  activated?: boolean;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-bold">Connexion</h1>
        <p className="text-sm text-muted-foreground">
          Accédez à votre espace HomeCycl&apos;Home.
        </p>
      </div>

      {/* Destination de la redirection d'activation (T-V3-02,
          `US-COMPTE-ACTIVER` §Cas nominal : « redirigé vers la page de connexion
          avec message “Compte activé, vous pouvez vous connecter” »).
          `role="status"` et non `alert` : le repère `alert` de cet écran
          appartient au refus de connexion, et deux le rendraient ambigu. */}
      {activated ? (
        <p role="status" className="text-sm">
          Compte activé, vous pouvez vous connecter.
        </p>
      ) : null}

      <LoginForm next={next} />
    </main>
  );
}
