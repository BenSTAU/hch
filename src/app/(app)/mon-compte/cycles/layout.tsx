import type { ReactNode } from "react";

import { CoquilleEspaceClient } from "@/components/layouts/coquille-espace-client";

/// Segment « Mes vélos » - écran **C11**.
///
/// ⚠️ **Un layout pour ce seul segment, et pas un `mon-compte/layout.tsx`.**
/// Le voisin `/mon-compte/supprimer` est une page **autonome**, volontairement
/// ouverte à tous les rôles et atteignable depuis la politique de
/// confidentialité : lui imposer la coquille de l'espace client l'habillerait
/// d'une navigation qui répond 403 à un technicien. C'est exactement le défaut
/// que T-V2-05 a corrigé sur son lien de retour.
///
/// La garde de rôle n'est **pas** ici mais dans la page : un layout partagé
/// n'est pas rejoué en navigation client (Partial Rendering), donc un check
/// qui y vivrait deviendrait obsolète (CLAUDE.md §Authentication).
export default function CyclesLayout({ children }: { children: ReactNode }) {
  return <CoquilleEspaceClient actif="cycles">{children}</CoquilleEspaceClient>;
}
