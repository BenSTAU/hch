"use client";

import { CalendarDays, CalendarRange, History } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { ONGLETS_TOURNEE, type CleOnglet } from "./onglets";

/// Barre latérale de l'espace technicien - maquette **T1**, `code.html:125-171`.
///
/// ── Trois entrées, et pas six
///
/// La maquette en dessine six. « Ma zone », « Profil » et « Aide » n'ont aucune
/// US : les poser produirait trois liens morts dans une navigation permanente,
/// ce que la leçon `T-T2-16` d'Argo proscrit et que la barre de l'espace client
/// évite déjà nommément. Le CTA « Nouvelle Intervention » ne se porte pas non
/// plus, `US-INTERVENTION-CREER` étant **v2 admin**.
///
/// L'identité en bas de barre ne se porte pas davantage : `US-COMPTE-DECONNECTER`
/// §Contexte l'impose « dans le header », où `UserMenu` la rend déjà. La
/// dupliquer donnerait deux menus pour une seule personne.
///
/// ── Pourquoi une feuille cliente
///
/// `usePathname` pour marquer l'entrée courante. C'est la seule chose que ce
/// composant fait de dynamique, et un layout ne peut pas la connaître autrement :
/// il ne reçoit pas la route de ses enfants. La frontière `"use client"` descend
/// donc jusqu'ici et pas au layout (CLAUDE.md §Architecture App Router).
///
/// ⚠️ Aucun contrôle d'accès ici ni dans le layout qui la monte. C'est chaque
/// page qui appelle `requireTech()` : le Partial Rendering ne rejoue pas un
/// layout en navigation client, un contrôle posé là-haut deviendrait obsolète
/// sans que rien ne le signale.
const ICONES: Record<CleOnglet, typeof CalendarDays> = {
  "du-jour": CalendarDays,
  "a-venir": CalendarRange,
  passees: History,
};

export function BarreLateraleTechnicien() {
  const chemin = usePathname();

  return (
    // Masquée sous `md`, exactement comme celle de l'espace client : sur un
    // téléphone elle mangerait un tiers de l'écran pour redire où l'on est. Ce
    // sont les onglets en tête de contenu qui portent la navigation réelle - la
    // maquette, elle, n'a **rien** prévu en mobile (`hidden md:flex`).
    <nav
      aria-label="Espace technicien"
      // Un PANNEAU, comme T1, et non une liste posée sur le fond de page :
      // `bg-surface-container-low` dans la maquette, `bg-secondary` dans le
      // vocabulaire shadcn de la palette. `sticky` plutôt que le `fixed
      // h-screen` de la maquette - la barre du site est déjà collante, et deux
      // éléments fixes qui se superposent au zoom 200 % est une régression
      // RGAA que la même règle avait déjà fait écarter sur `SiteHeader`.
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
                // `aria-current="page"` : ce sont des liens de navigation, pas
                // les onglets d'un widget. Et il ne double pas la couleur, il
                // la remplace comme information - la teinte seule ne suffit
                // pas (WCAG 1.4.1, RGAA A).
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
