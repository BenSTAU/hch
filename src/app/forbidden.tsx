import Link from "next/link";

/// Rendu par Next quand un composant appelle `forbidden()` — ici
/// `src/lib/auth/permissions.ts`. La DoD de T-J0-05 exige *« un refus, pas une
/// page vide »* : la page dit ce qui s'est passé, et ne propose pas de se
/// reconnecter. Se reconnecter n'y changerait rien, la session est valide et
/// c'est le rôle qui ne l'est pas.
///
/// Next pose `<meta name="robots" content="noindex" />` de lui-même sur cette
/// réponse.
export default function Forbidden() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="font-heading text-3xl font-bold">Accès refusé</h1>
      <p className="text-sm text-muted-foreground">
        Votre compte n&apos;a pas les droits nécessaires pour consulter cette
        page.
      </p>
      <Link href="/" className="text-sm underline underline-offset-4">
        Retour à l&apos;accueil
      </Link>
    </main>
  );
}
