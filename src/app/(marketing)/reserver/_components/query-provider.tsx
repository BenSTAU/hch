"use client";

import { QueryClientProvider } from "@tanstack/react-query";

import { getQueryClient } from "@/lib/query/get-query-client";

/// Fournisseur TanStack Query, monté **sur la seule route du tunnel**.
///
/// Pas dans `src/app/layout.tsx` : PLAN S1 §6.1 pose un périmètre strict de
/// trois vues, et un fournisseur global embarquerait la bibliothèque dans le
/// bundle de toutes les pages — dont la landing, qui n'en a aucun usage.
///
/// Motif donut : il accepte `children` et reçoit des Server Components depuis
/// l'extérieur, ce qui garde la frontière `"use client"` au plus près des
/// composants réellement interactifs.
export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}
