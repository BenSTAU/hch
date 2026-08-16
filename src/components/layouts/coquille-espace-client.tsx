import { Bike, CalendarDays } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { CHEMIN_CYCLES, CHEMIN_ESPACE_CLIENT } from "@/lib/routes";
import { cn } from "@/lib/utils";

/// Coquille de l'espace client - gabarit, barre latérale et `Toaster`, partagés
/// par les deux segments qui le composent : `/mes-interventions/*` (C8, C10) et
/// `/mon-compte/cycles` (C11).
///
/// Elle vivait dans `mes-interventions/layout.tsx` tant qu'un seul segment
/// l'utilisait. C11 est le **deuxième usage**, donc le moment où elle monte
/// dans `components/layouts/` - pas avant, règle des 2 usages.
///
/// ── La barre latérale ne porte toujours que ce qui existe
///
/// C8 et C10 en dessinent six entrées, C11 cinq. **Trois n'ont aucune route** :
/// « Tableau de bord » est C7, retiré du produit le 2026-08-09 ; « Profil » et
/// « Adresses » arrivent avec T-V3-07 (C12) ; « Aide » ne correspond à rien en
/// v1. Un lien mort dans une navigation permanente est la leçon T-T2-16 d'Argo :
/// il promet un écran que personne ne livrera avant sa tâche.
///
/// Deux entrées, donc, depuis que « Mes vélos » a la sienne.
///
/// ⚠️ **Pas de `loading.tsx` dans ces segments.** Sa fallback fait partir les
/// en-têtes en 200, après quoi le `forbidden()` de `requireEspaceClient()` ne
/// peut plus poser son 403 (docs Next, `file-conventions/loading` §Status
/// codes). Un squelette doit vivre sous un `<Suspense>` interne à la page, sous
/// la garde.
export type SegmentEspaceClient = "interventions" | "cycles";

const ENTREES: {
  segment: SegmentEspaceClient;
  href: string;
  libelle: string;
  Icone: typeof CalendarDays;
}[] = [
  {
    segment: "interventions",
    href: CHEMIN_ESPACE_CLIENT,
    libelle: "Interventions",
    Icone: CalendarDays,
  },
  {
    segment: "cycles",
    href: CHEMIN_CYCLES,
    libelle: "Mes vélos",
    Icone: Bike,
  },
];

export function CoquilleEspaceClient({
  actif,
  children,
}: {
  actif: SegmentEspaceClient;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-[1920px] flex-1 flex-col gap-8 px-5 py-6 md:flex-row md:px-16 md:py-10">
      {/* 🐛 **Visible au téléphone, en rangée.** Elle était `hidden md:block`,
          héritage du temps où elle ne portait qu'« Interventions » : la masquer
          ne coûtait rien puisque l'en-tête du site mène déjà là. Avec « Mes
          vélos », la même règle **orpheline l'écran** - `navigationPrincipale`
          ne porte pas cette entrée, le menu mobile non plus, et C11 n'était
          plus atteignable que par son URL. Constaté au navigateur en 375 px.

          Rangée sous `md`, colonne au-dessus : deux entrées tiennent sur une
          ligne, et `overflow-x-auto` encaisse la troisième que C12 apportera
          sans reposer la question.

          Depuis le 2026-08-16, `user-menu.tsx` porte lui aussi « Mes vélos » :
          l'écran n'est donc plus orphelin hors de la coquille. Cette barre
          reste néanmoins visible au téléphone, parce qu'elle marque l'entrée
          courante, ce qu'un menu qu'il faut ouvrir ne fait pas. */}
      <nav aria-label="Espace client" className="w-full shrink-0 md:w-56">
        <ul className="flex flex-row gap-2 overflow-x-auto md:flex-col md:gap-1 md:overflow-visible">
          {ENTREES.map(({ segment, href, libelle, Icone }) => {
            const courant = segment === actif;

            return (
              <li key={segment}>
                <Link
                  href={href}
                  // `aria-current="page"` et non une classe seule : la couleur
                  // ne dit rien à un lecteur d'écran, et deux entrées ne
                  // peuvent pas être courantes.
                  aria-current={courant ? "page" : undefined}
                  className={cn(
                    // `whitespace-nowrap` : en rangée, « Mes vélos » se casserait
                    // en deux lignes dès que la troisième entrée serrera la
                    // largeur.
                    "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold whitespace-nowrap transition-colors",
                    courant
                      ? "bg-primary-fixed/40 text-primary hover:bg-primary-fixed/60"
                      : "text-muted-foreground hover:bg-secondary",
                  )}
                >
                  <Icone aria-hidden="true" className="size-5" />
                  {libelle}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>

      {/* Monté ICI et non dans le layout racine : le `Toaster` est un composant
          client, et le poser à la racine ferait voyager sonner jusqu'à la
          landing, qui n'en a aucun usage. L'espace technicien a le sien, pour
          la même raison et depuis T-V2-03.

          Il vit **hors** du bloc qui rend `children` : la ligne annulée quitte
          la liste au même instant, donc l'émetteur du message se démonte. Le
          récepteur, lui, doit rester. */}
      <Toaster />
    </main>
  );
}
