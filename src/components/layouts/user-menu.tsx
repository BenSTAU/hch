"use client";

import {
  CalendarDays,
  ChevronDown,
  LogOut,
  Route,
  Settings,
} from "lucide-react";
import Link from "next/link";

import { logout } from "@/lib/actions/auth/logout";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { EspacePrincipal } from "./site-navigation";

/// Une référence de composant ne traverse pas la frontière serveur → client :
/// le chemin et le libellé arrivent en props, le pictogramme se choisit ici.
const ICONES: Record<EspacePrincipal, typeof CalendarDays> = {
  client: CalendarDays,
  tech: Route,
  admin: Settings,
};

/// Menu utilisateur de l'en-tête - `US-COMPTE-DECONNECTER` §Contexte, qui place
/// l'action « dans le menu utilisateur (avatar / initiales dans le header) ».
///
/// `espace` arrive **déjà résolu** : ce composant ne connaît pas les rôles.
/// Feuille cliente, la frontière `"use client"` s'arrête ici.
///
/// ⚠️ Écart ouvert : la déconnexion n'est pas atteignable sans JavaScript.
/// `site-header.tsx` porte le repli `<noscript>`. Cf. [[points-ouverts-hch]].
/// Historique de la fusion des deux en-têtes et arbitrage initiales contre
/// photo : TASKS T-V3-10 et [[maquettage]] §Notes portage.
export function UserMenu({
  user,
  espace,
}: {
  user: { firstname: string; lastname: string };
  espace: { espace: EspacePrincipal; href: string; label: string };
}) {
  const nom = `${user.firstname} ${user.lastname}`;
  const IconeEspace = ICONES[espace.espace];

  return (
    <DropdownMenu>
      {/* `aria-label` et non un `sr-only` : le nom est déjà rendu à côté, et
          un second nœud de texte le dirait deux fois. */}
      <DropdownMenuTrigger
        aria-label={`Ouvrir le menu de ${nom}`}
        className="flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Avatar className="size-9">
          {/* Sans `aria-hidden`, un lecteur d'écran annonce « SD Sophie
              Dumas » : les initiales redoublent le nom rendu à côté. */}
          <AvatarFallback
            aria-hidden="true"
            className="bg-primary-fixed font-semibold text-primary"
          >
            {initiales(user)}
          </AvatarFallback>
        </Avatar>
        {/* Masqué sous `sm` : il reste dans le nom accessible ci-dessus. */}
        <span className="hidden text-sm font-medium sm:inline">{nom}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 text-muted-foreground"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        {/* Ni email ni rôle : sur un poste partagé, une adresse affichée en
            permanence est une donnée personnelle exposée sans motif. */}
        <DropdownMenuLabel>{nom}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href={espace.href}>
            <IconeEspace aria-hidden="true" />
            {espace.label}
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Une mutation, donc une Server Action et non un `onClick`.
            `asChild` porte `menuitem` sur le bouton, pas sur le form. */}
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

/// Deux lettres, celles de la maquette. Le patronyme peut être vide après
/// pseudonymisation : la seconde lettre manque alors, sans remplissage.
function initiales(user: { firstname: string; lastname: string }): string {
  return `${user.firstname.trim().charAt(0)}${user.lastname.trim().charAt(0)}`.toUpperCase();
}
