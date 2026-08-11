import { CalendarDays } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { CHEMIN_ESPACE_CLIENT } from "@/lib/routes";

/// Coquille de l'espace client — écrans **C8** et **C10**.
///
/// T-V3-10 en est propriétaire depuis l'arbitrage du 2026-08-10 : trois tâches
/// revendiquaient C8, et c'est la liste qui est la structure porteuse. T-V3-11
/// viendra y monter son bouton d'annulation, elle ne crée ni route ni layout.
///
/// ── La barre latérale ne porte que ce qui existe
///
/// C8 et C10 en dessinent six entrées : Tableau de bord, Interventions, Mes
/// Vélos, Profil, Adresses, Aide. **Cinq n'ont aucune route.** « Tableau de
/// bord » est C7, retiré du produit le 2026-08-09 (aucune US ne le demande, il
/// a servi à calibrer le brief Stitch) ; « Mes Vélos », « Profil » et
/// « Adresses » arrivent avec T-V3-07 (C11 et C12) ; « Aide » ne correspond à
/// rien en v1.
///
/// Une seule entrée est donc posée. Un lien mort dans une navigation
/// permanente est la leçon T-T2-16 d'Argo, et il coûte plus cher qu'une barre
/// courte : il promet un écran que personne ne livrera avant sa tâche.
export default function EspaceClientLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-[1920px] flex-1 flex-col gap-8 px-5 py-6 md:flex-row md:px-16 md:py-10">
      {/* Masquée sous `md` : avec une seule entrée, elle mangerait un tiers de
          l'écran d'un téléphone pour redire où l'on est déjà. Les onglets de
          chaque page portent la navigation réelle de l'espace. */}
      <nav aria-label="Espace client" className="hidden w-56 shrink-0 md:block">
        <ul>
          <li>
            <Link
              href={CHEMIN_ESPACE_CLIENT}
              className="flex items-center gap-3 rounded-xl bg-primary-fixed/40 px-4 py-3 text-sm font-semibold text-primary transition-colors hover:bg-primary-fixed/60"
            >
              <CalendarDays aria-hidden="true" className="size-5" />
              Interventions
            </Link>
          </li>
        </ul>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
    </main>
  );
}
