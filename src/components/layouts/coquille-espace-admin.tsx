import { Settings, Tag } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  NAV_ADMIN,
  type SegmentAdmin,
} from "@/components/layouts/admin-navigation";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

/// Coquille du back-office - gabarit, barre latérale et `Toaster`, partagés par
/// les segments de `/admin/*`. Même forme que `CoquilleEspaceClient`.
///
/// ⚠️ **Pas de `loading.tsx` dans ces segments.** Sa fallback fait partir les
/// en-têtes en 200, après quoi le `forbidden()` de `requireAdmin()` ne peut
/// plus poser son 403. Un squelette doit vivre sous un `<Suspense>` interne à
/// la page, sous la garde.
const ICONES: Record<SegmentAdmin, typeof Tag> = {
  forfaits: Tag,
  parametres: Settings,
};

export function CoquilleEspaceAdmin({
  actif,
  children,
}: {
  actif: SegmentAdmin;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-[1920px] flex-1 flex-col gap-8 px-5 py-6 md:flex-row md:px-16 md:py-10">
      <nav aria-label="Administration" className="w-full shrink-0 md:w-56">
        <ul className="flex flex-row gap-2 overflow-x-auto md:flex-col md:gap-1 md:overflow-visible">
          {NAV_ADMIN.map(({ segment, href, libelle }) => {
            const courant = segment === actif;
            const Icone = ICONES[segment];

            return (
              <li key={segment}>
                <Link
                  href={href}
                  // La couleur ne dit rien à un lecteur d'écran, et deux
                  // entrées ne peuvent pas être courantes.
                  aria-current={courant ? "page" : undefined}
                  className={cn(
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

      {/* Hors du bloc qui rend `children` : l'émetteur d'un message se démonte
          souvent avec la ligne qu'il concerne, le récepteur doit rester. */}
      <Toaster />
    </main>
  );
}
