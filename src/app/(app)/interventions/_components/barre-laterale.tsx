"use client";

import { CalendarDays, CalendarRange, History } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { ONGLETS_TOURNEE, type CleOnglet } from "./onglets";

/// Barre latérale de l'espace technicien - maquette **T1**, `code.html:125-171`.
///
/// Cliente pour le seul `usePathname` : un layout ne reçoit pas la route de ses
/// enfants, donc il ne peut pas marquer l'entrée courante.
///
/// ⚠️ Aucun contrôle d'accès ici ni dans le layout. Chaque page appelle
/// `requireTech()` - le Partial Rendering ne rejoue pas un layout en navigation
/// client (CLAUDE.md §Authentication).
///
/// Trois entrées sur les six de la maquette : motif du retrait des trois autres
/// dans TASKS T-V2-05.
const ICONES: Record<CleOnglet, typeof CalendarDays> = {
  "du-jour": CalendarDays,
  "a-venir": CalendarRange,
  passees: History,
};

export function BarreLateraleTechnicien() {
  const chemin = usePathname();

  return (
    // Masquée sous `md` : ce sont les onglets en tête de contenu qui portent
    // la navigation là, et ils sont `md:hidden` en miroir.
    <nav
      aria-label="Espace technicien"
      // `sticky` et non le `fixed h-screen` de la maquette : la barre du site
      // est déjà collante, et deux éléments fixes se superposent au zoom 200 %.
      className="hidden w-56 shrink-0 self-start rounded-2xl bg-secondary/60 p-3 md:sticky md:top-24 md:block"
    >
      <ul className="flex flex-col gap-1">
        {ONGLETS_TOURNEE.map((onglet) => {
          const courant = chemin === onglet.href;
          const Icone = ICONES[onglet.cle];

          return (
            <li key={onglet.cle}>
              <Link
                href={onglet.href}
                // `aria-current` et non la seule teinte : la couleur seule ne
                // porte pas l'information (WCAG 1.4.1, RGAA A).
                aria-current={courant ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition-colors",
                  courant
                    ? "bg-card font-bold text-primary shadow-sm"
                    : "font-semibold text-muted-foreground hover:bg-card/60 hover:text-foreground",
                )}
              >
                <Icone aria-hidden="true" className="size-5" />
                {onglet.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
