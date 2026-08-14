import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";

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

      {/* 🐛 **Il manquait, et les toasts de T-V2-02 ne s'affichaient nulle
          part.** `bouton-demarrer.tsx` émet `toast.success` et `toast.error`
          depuis la tournée comme depuis le détail, or le seul `<Toaster>` du
          produit vivait dans le layout de l'espace CLIENT. Sonner pousse dans un
          magasin interne qu'aucun abonné ne lisait ici : ni le succès, ni les
          deux refus métier n'atteignaient l'écran, et le technicien n'avait
          aucun retour sur un clic dont l'effet est irréversible.

          L'E2E ne pouvait pas le voir : son oracle est `/Intervention démarrée
          à/`, qui est le **jalon du hub**, pas le toast `Intervention démarrée`.
          Deux chaînes voisines, dont une seule était prouvée.

          Corrigé ici et pas ailleurs parce que la case « toast Sonner
          repositionné » de T-V2-03 est inatteignable sans lui.

          `position="bottom-center"` : c'est ce que la maquette **T4** dessine,
          et c'est la zone du pouce sur le téléphone que le technicien tient
          d'une main. ⚠️ L'espace client reste au défaut de shadcn
          (`bottom-right`), qu'aucune maquette ne contredit. Deux contextes, deux
          positions - à unifier d'un mot si le write-back le tranche.

          Hors du bloc qui rend `children` : la ligne clôturée quitte la tournée
          au même instant, donc l'émetteur du message se démonte. Le récepteur,
          lui, doit rester. */}
      <Toaster position="bottom-center" />
    </main>
  );
}
