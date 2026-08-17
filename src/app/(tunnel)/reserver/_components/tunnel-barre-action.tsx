import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { CONTENEUR } from "./etapes";

/// Barre d'actions basse - `c2:265-274`, `c3:309-321`, `c4:225-234`.
///
///   · barre `fixed` en bas, fond `surface-container-lowest`, filet supérieur,
///     ombre montante `0 -4px 20px rgba(0,0,0,.05)` ;
///   · `py-4`, gouttières 20 / 64 px, contenu `max-w-7xl`, action de retour à
///     gauche et action principale à droite ;
///   · boutons `px-6 py-3 rounded-xl`, libellés `label-md`.
///
/// **Absente de C5** (`c5:113` n'a pas de pied), et [[maquettage]] §Notes
/// portage le confirme : au récapitulatif, l'appel à l'action vit dans la
/// colonne collante. Le tunnel ne la rend donc que sur les trois premiers pas.
///
/// `fixed` ici, quand le stepper est `sticky` : cette barre porte le seul moyen
/// d'avancer, et une barre d'action qui défile hors de l'écran sur une liste de
/// créneaux longue oblige à revenir en bas de page pour continuer. Le contenu
/// compense par `pb-24`.
///
/// ⚠️ **Sa hauteur doit rester d'une ligne, à toute largeur.** C'est la
/// compensation du contenu qui en dépend : dès qu'un libellé passe sur deux
/// lignes, la barre grandit sans que le `pb-24` du contenu le sache, et elle
/// recouvre le bas de l'écran - la card de récapitulatif de l'étape créneau,
/// dont le total se fait manger. La divergence était nommée pour C3 dans
/// [[maquettage]] §Notes portage (« nav bottom sticky coupe la card résultat »)
/// et traitée écran par écran, alors que la barre est PARTAGÉE : elle
/// réapparaissait sur C4. Le correctif se pose ici, pas sur un écran de plus.
export function TunnelBarreAction({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
      <div
        className={cn(
          CONTENEUR,
          "flex items-center justify-between gap-3 py-4",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/// Classe des deux boutons de la barre, `px-6 py-3` comme la maquette.
///
/// `h-auto` est indispensable : toutes les tailles du catalogue `radix-nova`
/// imposent une hauteur fixe (`size="default"` vaut 32 px, `lg` 36 px) et le
/// padding vertical n'aurait aucun effet sans elle. ADR-012 §D4 - la maquette
/// fait foi, la valeur par défaut du catalogue n'est pas un plancher.
///
/// `px-4` sous `sm` : à 375 px, deux boutons à `px-6` et leurs libellés longs
/// débordent la gouttière de 20 px, et l'action principale sort du cadre à
/// droite. `whitespace-nowrap` interdit le repli sur deux lignes, `min-w-0`
/// laisse le bouton se contracter au lieu de pousser son voisin dehors.
export const BOUTON_BARRE =
  "h-auto min-w-0 rounded-xl px-4 py-3 text-sm font-semibold tracking-[0.05em] whitespace-nowrap sm:px-6";

/// Libellé qui se raccourcit sur téléphone.
///
/// Deux variantes dans le DOM plutôt qu'un `aria-label` : la variante masquée
/// l'est par `display:none`, donc elle n'est ni lue ni atteinte, et le nom
/// accessible reste **exactement** le texte visible (WCAG 2.5.3, « label in
/// name », qu'un `aria-label` divergent met en tension).
export function LibelleBarre({ court, long }: { court: string; long: string }) {
  return (
    <>
      <span className="sm:hidden">{court}</span>
      <span className="hidden sm:inline">{long}</span>
    </>
  );
}
