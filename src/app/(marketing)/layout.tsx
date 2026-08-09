import type { ReactNode } from "react";

import { getOptionalUser } from "@/lib/auth/dal";
import { listForfaitsPublics } from "@/lib/db/queries/forfaits";
import { SiteFooter } from "@/components/layouts/site-footer";
import { SiteHeader } from "@/components/layouts/site-header";

/// Coquille publique — en-tête et pied de page partagés par la landing, les
/// pages légales de T-V3-12 et le tunnel de T-V3-08.
///
/// Le groupe s'appelle `(marketing)` et non `(public)` comme l'écrit la DoD :
/// c'est le nom du trio par défaut de CLAUDE.md §Architecture App Router
/// (`(marketing)`, `(auth)`, `(app)`), et le groupe existe déjà depuis le
/// jalon 0. Écart signalé au write-back.
///
/// ⚠️ **Ce n'est pas une garde.** `getOptionalUser` renseigne l'en-tête sur la
/// présence d'une session, il n'autorise rien et ne redirige personne — la page
/// doit rester ouverte à tous (Constitution §5.1). Les contrôles d'accès
/// restent dans chaque page (CLAUDE.md §Authentication : le Partial Rendering
/// ne rejoue pas un layout en navigation client, un check posé ici deviendrait
/// obsolète sans que rien ne le signale).
///
/// Les deux lectures sont indépendantes, donc en parallèle. Celle du catalogue
/// sert uniquement à savoir si l'en-tête propose un appel à la réservation :
/// `US-FORFAIT-CONSULTER` §Cas limites l'interdit quand aucun forfait n'est
/// actif. Elle ne coûte pas une requête de plus — `listForfaitsPublics` est
/// enveloppée dans `cache()`, la page la rappelle dans le même rendu.
export default async function CoquillePubliqueLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [user, forfaits] = await Promise.all([
    getOptionalUser(),
    listForfaitsPublics(),
  ]);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader user={user} reservationDisponible={forfaits.length > 0} />
      {children}
      <SiteFooter />
    </div>
  );
}
