import Link from "next/link";

import { LogoutButton } from "@/components/features/auth/logout-button";

/// En-tête de l'espace connecté — point d'accès à la déconnexion.
///
/// `US-COMPTE-DECONNECTER` §Contexte place l'action « dans le menu utilisateur
/// (avatar / initiales dans le header) ». Le menu déroulant et l'avatar
/// appartiennent au portage des écrans C7/C8, qui revient à T-V3-10 : ici,
/// le strict nécessaire pour que la déconnexion soit ATTEIGNABLE — sans quoi
/// elle n'existerait que comme endpoint.
///
/// Il reçoit son utilisateur en prop et ne lit rien lui-même. La lecture vit
/// dans le layout, et surtout la **garde de rôle reste dans chaque page**
/// (CLAUDE.md §Authentication : jamais de contrôle d'autorisation dans un
/// layout partagé — le Partial Rendering ne le rejoue pas en navigation
/// client).
///
/// Ni email ni rôle affichés : le DTO du DAL les porte, l'en-tête n'en a pas
/// besoin, et sur un poste partagé une adresse affichée en permanence est une
/// donnée personnelle exposée sans motif.
export function AppHeader({
  user,
}: {
  user: { firstname: string; lastname: string };
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b px-4 py-3 sm:px-8">
      <Link
        href="/"
        className="font-heading text-lg font-bold tracking-tight text-primary"
      >
        HomeCycl&apos;Home
      </Link>

      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">
          {user.firstname} {user.lastname}
        </span>
        <LogoutButton />
      </div>
    </header>
  );
}
