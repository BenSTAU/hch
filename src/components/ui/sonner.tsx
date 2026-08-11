"use client";

import type { CSSProperties } from "react";
import { CircleCheckIcon, OctagonXIcon } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/// Notifications éphémères - `Sonner` du catalogue shadcn.
///
/// ⚠️ **Le registry livre ce fichier branché sur `next-themes`**, qu'il installe
/// au passage. La dépendance est retirée ici : aucune classe `.dark` n'est posée
/// en v1 (`globals.css:5-9`, ADR-012 §D4 ne spécifie pas de palette sombre), un
/// sélecteur de thème n'aurait donc rien à sélectionner. À reporter si ce
/// fichier est régénéré, comme le « Close » du `Sheet` et les libellés du
/// `Calendar`.
///
/// Les icônes `warning`, `info` et `loading` du registry ne sont pas reprises :
/// aucun appelant n'émet ces trois variantes, et une icône importée sans usage
/// voyage jusqu'au navigateur.
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as CSSProperties
      }
      toastOptions={{ classNames: { toast: "cn-toast" } }}
      {...props}
    />
  );
}
