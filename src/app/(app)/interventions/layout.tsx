import type { ReactNode } from "react";

import { BarreLateraleTechnicien } from "./_components/barre-laterale";

/// Coquille de l'espace technicien - écran **T1** et ses deux déclinaisons.
///
/// T-V2-01 avait porté le **contenu** de T1 sans sa **navigation** : sa DoD ne
/// parlait que de la tournée du jour, donc l'écran est arrivé sans les trois
/// onglets que la maquette dessine. Trou de cadrage, pas dérive
/// d'implémentation. T-V2-05 le referme.
///
/// ⚠️ **Aucun contrôle d'accès ici**, et c'est une règle, pas un oubli : le
/// Partial Rendering ne rejoue pas un layout en navigation client, un
/// `requireTech()` posé là deviendrait obsolète sans que rien ne le signale
/// (CLAUDE.md §Authentication). Chaque page porte sa garde, et chacune la porte
/// vraiment.
///
/// ⚠️ **Et pas de `loading.tsx` dans ce segment non plus.** Sa fallback fait
/// partir les en-têtes en 200, après quoi le `forbidden()` de la page ne peut
/// plus poser son 403 (docs Next, `file-conventions/loading` §Status codes).
/// Un squelette doit vivre sous un `<Suspense>` interne à la page, sous la
/// garde.
///
/// Il ne monte pas non plus `QueryProvider` : le polling de 30 s n'appartient
/// qu'à la tournée du jour (PLAN S1 §6.1 n'autorise TanStack Query que sur trois
/// vues du produit, dont une seule est technicien). Le poser ici l'étendrait
/// aux deux vues qui n'en ont aucun usage.
export default function EspaceTechnicienLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-[1920px] flex-1 flex-col gap-8 px-5 py-6 md:flex-row md:px-16 md:py-10">
      <BarreLateraleTechnicien />

      <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
    </main>
  );
}
