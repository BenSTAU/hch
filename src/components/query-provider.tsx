"use client";

import { QueryClientProvider } from "@tanstack/react-query";

import { getQueryClient } from "@/lib/query/get-query-client";

/// Fournisseur TanStack Query, monté **route par route**, jamais à la racine.
///
/// Pas dans `src/app/layout.tsx` : PLAN S1 §6.1 pose un périmètre strict de
/// trois vues, et un fournisseur global embarquerait la bibliothèque dans le
/// bundle de toutes les pages — dont la landing, qui n'en a aucun usage. Les
/// trois vues sont la grille de créneaux du tunnel, la tournée du jour du
/// technicien, et le planning admin qui reste à venir.
///
/// ── Pourquoi il vit ici, à la racine de `components/`
///
/// Il est né dans `app/(tunnel)/reserver/_components/` et T-V2-01 est son
/// **deuxième usage** : la règle des 2 usages (CLAUDE.md §Folder structure) le
/// fait donc sortir du dossier privé d'une route. Aucun des trois seaux
/// documentés ne lui va — ce n'est ni une primitive `ui/`, ni une `layouts/`, et
/// surtout pas un `features/<domaine>/` : la troisième vue est le **planning
/// admin**, qui n'appartient pas au domaine `interventions`, et le ranger sous
/// un domaine ferait importer son infrastructure depuis le dossier d'un autre.
///
/// `lib/` est exclu par construction, c'est la couche sans JSX. Et pas de
/// dossier `providers/` pour un fichier unique : une place gardée pour un
/// occupant hypothétique est ce que ce dépôt refuse ailleurs. Un second
/// fournisseur le promouvra.
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
