import type { ReactNode } from "react";

/// État vide d'une liste, sans connaissance du domaine : un titre, une
/// explication, et l'action qui sort de cet état.
///
/// L'action est passée en `children` plutôt que décrite en props : selon
/// l'écran c'est un lien, un bouton ou rien du tout, et une prop `href`
/// imposerait le premier cas à tous les autres.
export function EtatVide({
  titre,
  description,
  children,
}: {
  titre: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center">
      <p className="font-heading text-lg font-semibold">{titre}</p>
      {description ? (
        <p className="max-w-prose text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {children}
    </div>
  );
}
