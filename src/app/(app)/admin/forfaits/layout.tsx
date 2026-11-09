import type { ReactNode } from "react";

import { CoquilleEspaceAdmin } from "@/components/layouts/coquille-espace-admin";

/// Segment du catalogue des forfaits - écran **A3**.
///
/// ⚠️ **Aucune garde ici.** Le Partial Rendering ne rejoue pas un layout
/// partagé en navigation client : le contrôle y deviendrait obsolète
/// (CLAUDE.md §Authentication). `requireAdmin()` vit dans chaque page et dans
/// chaque action.
export default function AdminForfaitsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <CoquilleEspaceAdmin actif="forfaits">{children}</CoquilleEspaceAdmin>;
}
