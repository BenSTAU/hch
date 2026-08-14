import type { ReactNode } from "react";

import { CoquilleEspaceClient } from "@/components/layouts/coquille-espace-client";

/// Segment des interventions du client - écrans **C8** et **C10**.
///
/// T-V3-10 en est propriétaire depuis l'arbitrage du 2026-08-10 : trois tâches
/// revendiquaient C8, et c'est la liste qui est la structure porteuse. T-V3-11
/// est venue y monter son bouton d'annulation, elle n'a créé ni route ni layout.
///
/// Le gabarit, la barre latérale et le `Toaster` vivaient ici jusqu'à T-V3-16,
/// qui pose un second segment dans le même espace (C11) : ils sont montés dans
/// `components/layouts/coquille-espace-client.tsx` au deuxième usage, et c'est
/// là que leurs commentaires ont suivi.
export default function EspaceClientLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <CoquilleEspaceClient actif="interventions">
      {children}
    </CoquilleEspaceClient>
  );
}
