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
export function ConnexionView({ next }: { next?: string | undefined }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-bold">Connexion</h1>
        <p className="text-sm text-muted-foreground">
          Accédez à votre espace HomeCycl&apos;Home.
        </p>
      </div>

      <LoginForm next={next} />
    </main>
  );
}
