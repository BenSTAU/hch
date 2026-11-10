import type { ReactNode } from "react";

import { CoquilleEspaceAdmin } from "@/components/layouts/coquille-espace-admin";

/// Segment de la configuration société. Même motif que le segment des
/// forfaits : la coquille ici, la garde dans la page.
export default function AdminParametresLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <CoquilleEspaceAdmin actif="parametres">{children}</CoquilleEspaceAdmin>
  );
}
