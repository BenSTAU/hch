"use client";

import { Eye, EyeOff } from "lucide-react";

import { cn } from "@/lib/utils";

/// Bascule d'affichage d'un champ mot de passe - maquettes **C6** et **C7**.
///
/// Écrite deux fois jusqu'à l'audit du 2026-08-12, dans `login-form.tsx` et
/// `signup-form.tsx`, **avec deux traitements d'accessibilité différents**.
///
/// ⚠️ **Le traitement retenu est celui de la connexion, et l'écart n'était pas
/// cosmétique.** L'inscription cumulait `aria-pressed` et un nom accessible
/// changeant : un lecteur d'écran y annonçait « Masquer le mot de passe,
/// activé », soit l'état deux fois, une fois par le nom et une fois par
/// l'attribut. Les deux conventions sont valides séparément - nom fixe plus
/// `aria-pressed`, ou nom changeant sans lui - mais leur cumul est ambigu.
///
/// `type="button"` explicite : un `<button>` sans type vaut `submit`, et
/// révéler son mot de passe enverrait le formulaire. Sans JavaScript il ne fait
/// rien, ce qui est le bon défaut - le champ reste masqué.
export function BasculeMotDePasse({
  visible,
  onBascule,
  controle,
  className,
}: {
  visible: boolean;
  onBascule: () => void;
  /// `id` du champ que la bascule pilote.
  controle: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onBascule}
      aria-label={
        visible ? "Masquer le mot de passe" : "Afficher le mot de passe"
      }
      aria-controls={controle}
      className={cn(
        "absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      {visible ? (
        <EyeOff aria-hidden="true" className="size-4" />
      ) : (
        <Eye aria-hidden="true" className="size-4" />
      )}
    </button>
  );
}
