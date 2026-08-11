"use client";

import { CalendarDays, ChevronDown, LogOut } from "lucide-react";
import Link from "next/link";

import { logout } from "@/lib/actions/auth/logout";
import { CHEMIN_ESPACE_CLIENT } from "@/lib/routes";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/// Menu utilisateur de l'en-tête — `US-COMPTE-DECONNECTER` §Contexte, qui place
/// l'action « dans le menu utilisateur (avatar / initiales dans le header) ».
///
/// Il remplace le couple « nom + bouton Se déconnecter » posé en T-V3-03, et
/// c'est la **fusion** que la DoD de T-V3-10 nomme : `SiteHeader` (coquille
/// publique, PR #21) et `AppHeader` (espace connecté, PR #20) cohabitaient
/// depuis deux tâches. `AppHeader` disparaît ici.
///
/// ── L'avatar porte des initiales, pas une photo
///
/// C7 et C8 dessinent la photo de Sophie ; `users` n'a aucune colonne d'avatar
/// et [[maquettage]] §Notes portage tranche « initiales SD sur primary-fixed ».
/// `AvatarImage` n'est donc pas monté du tout - un `Avatar` sans source rend son
/// `Fallback`, sans requête ni état de chargement.
///
/// ── Deux écarts de maquette, tracés
///
///  1. **C8 place l'identité en bas de sidebar**, pas dans un en-tête. C'est
///     `US-COMPTE-DECONNECTER` qui tranche, en écrivant « dans le HEADER » :
///     la sidebar de C8 est une navigation d'espace, pas un porteur d'identité,
///     et dupliquer l'identité aux deux endroits donnerait deux menus.
///  2. ⚠️ **La déconnexion cesse d'être atteignable sans JavaScript.** Depuis
///     T-V3-03 elle vivait dans un `<form action>` toujours visible, précisément
///     pour ce motif (« sur un poste partagé, le pire moment pour qu'elle soit
///     décorative »). Un menu déroulant ne s'ouvre pas sans JS. C'est la SPEC
///     qui l'y place ; l'écart est signalé en PR, il n'est pas absorbé.
///
/// Feuille cliente : la frontière `"use client"` descend jusqu'ici et pas plus
/// haut. `SiteHeader` reste un composant serveur.
export function UserMenu({
  user,
}: {
  user: { firstname: string; lastname: string };
}) {
  const nom = `${user.firstname} ${user.lastname}`;

  return (
    <DropdownMenu>
      {/* `aria-label` et non un `<span class="sr-only">` : le nom est déjà
          rendu visuellement dans le déclencheur, et un second nœud de texte le
          ferait apparaître deux fois dans le document. Le nom accessible est
          calculé à partir de l'attribut, qui prime sur le contenu. */}
      <DropdownMenuTrigger
        aria-label={`Ouvrir le menu de ${nom}`}
        className="flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Avatar className="size-9">
          {/* `aria-hidden` : les initiales redoublent le nom rendu juste à
              côté, et un lecteur d'écran annoncerait « SD Sophie Dumas ». */}
          <AvatarFallback
            aria-hidden="true"
            className="bg-primary-fixed font-semibold text-primary"
          >
            {initiales(user)}
          </AvatarFallback>
        </Avatar>
        {/* Le nom disparaît sous `sm`, l'avatar suffit à identifier le point
            d'entrée. Il reste dans le nom accessible du déclencheur. */}
        <span className="hidden text-sm font-medium sm:inline">{nom}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 text-muted-foreground"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        {/* Ni email ni rôle : le DTO du DAL les porte, le menu n'en a pas
            besoin, et sur un poste partagé une adresse affichée est une donnée
            personnelle exposée sans motif. */}
        <DropdownMenuLabel>{nom}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href={CHEMIN_ESPACE_CLIENT}>
            <CalendarDays aria-hidden="true" />
            Mes interventions
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Un `<form action>` et non un `onClick` : la déconnexion est une
            mutation, donc une Server Action. `asChild` porte le rôle
            `menuitem` sur le bouton, pas sur le formulaire. */}
        <form action={logout}>
          <DropdownMenuItem asChild variant="destructive">
            <button type="submit" className="w-full">
              <LogOut aria-hidden="true" />
              Se déconnecter
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/// Deux lettres, celles de la maquette (« SD » pour Sophie Dumas).
///
/// Le patronyme peut être vide en base après pseudonymisation : la seconde
/// lettre est alors absente plutôt que remplacée par un caractère de
/// remplissage.
function initiales(user: { firstname: string; lastname: string }): string {
  return `${user.firstname.trim().charAt(0)}${user.lastname.trim().charAt(0)}`.toUpperCase();
}
