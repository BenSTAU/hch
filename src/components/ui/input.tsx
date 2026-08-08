import * as React from "react";

import { cn } from "@/lib/utils";

/// Champ de saisie aligné sur la maquette **C6** au portage T-V3-02 : bloc
/// PLEIN, `h-11`, **angles droits**. Le défaut shadcn — `h-8`, fond transparent,
/// `rounded-xl` — donnait un champ deux fois plus bas, sans matière et arrondi
/// comme un bouton.
///
/// ⚠️ **Divergence assumée contre un MUST.** CLAUDE.md §Styling impose
/// `rounded-xl` sur « boutons ET inputs », d'après
/// [[adr-012-maquettage-stitch-shadcn|ADR-012]] §D4. La maquette C6, elle, dessine
/// des champs à angles droits et n'arrondit que les boutons. Arbitré par Benjamin
/// le 2026-08-08 sur constat visuel, en faveur de la maquette. **Writeback dû** :
/// ADR-012 §D4 et la ligne « angles » de CLAUDE.md doivent distinguer les deux.
///
/// ⚠️ La bordure est CONSERVÉE, contre la maquette qui n'en montre pas.
/// RGAA 1.4.11 / WCAG 1.4.11 demandent 3:1 sur les éléments non textuels : le
/// seul remplissage `secondary` (#f2f4f2) sur la carte blanche donne 1,06:1, et
/// la limite du champ cesserait d'être identifiable. `--input` (#7a8a85) tient
/// 3,45:1 — c'est le motif pour lequel globals.css le distingue de `--border`.
/// Sur l'écran justement classé **AA**, ce point ne se négocie pas.
///
/// La primitive est partagée : la connexion (T-J0-04) reprend la même forme,
/// c'est voulu — les deux vues appartiennent au même écran C6.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-none border border-input bg-secondary px-3 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
