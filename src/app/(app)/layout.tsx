import type { ReactNode } from "react";

import { getOptionalUser } from "@/lib/auth/dal";
import { listForfaitsPublics } from "@/lib/db/queries/forfaits";
import { SiteHeader } from "@/components/layouts/site-header";

/// Layout de l'espace connecté — il porte l'en-tête, donc la déconnexion.
///
/// Depuis T-V3-10 c'est **le même en-tête que la coquille publique**. `AppHeader`
/// est supprimé : les deux barres cohabitaient depuis T-V3-03, la DoD de cette
/// tâche les fusionne, et le menu utilisateur (avatar, initiales) vit désormais
/// dans `SiteHeader`.
///
/// ⚠️ **Ce n'est pas une garde, et depuis T-V3-10 ça se voit dans le code.**
/// La lecture ci-dessous sert à AFFICHER un nom. Chaque page garde son propre
/// contrôle — c'est lui qui refuse, et lui seul : le Partial Rendering ne
/// rejoue pas un layout en navigation client, un contrôle posé ici deviendrait
/// obsolète sans que rien ne le signale (CLAUDE.md §Authentication).
///
/// Elle appelait `getCurrentUser`, qui **redirige** en l'absence de session.
/// Le commentaire disait déjà que ce n'en était pas une garde ; le code en
/// était une quand même, et ça a fini par mordre. 🐛 Défaut réel trouvé par
/// l'E2E « reste sans erreur sur une session déjà close » : depuis une page de
/// cet espace, se déconnecter avec un cookie **déjà expiré** faisait rendre le
/// layout pendant le traitement de la Server Action, sa redirection vers
/// `/connexion` entrait en concurrence avec celle de l'action vers l'accueil,
/// et le navigateur affichait « An unexpected response was received from the
/// server » — là où `US-COMPTE-DECONNECTER` §Cas d'erreur exige un
/// comportement **idempotent**, « aucune erreur, je suis redirigé vers la page
/// publique ». Le cas n'a rien d'exotique : un cookie expire, ou un second
/// onglet ferme la session.
///
/// `getOptionalUser` renseigne sans rediriger. L'en-tête s'adapte, les pages
/// refusent.
///
/// Les deux lectures sont indépendantes, donc en parallèle. Celle du catalogue
/// ne sert qu'à savoir si l'en-tête propose un appel à la réservation :
/// `US-FORFAIT-CONSULTER` §Cas limites l'interdit quand aucun forfait n'est
/// actif, et la règle ne dépend pas du côté de la barrière où l'on se trouve.
export default async function EspaceConnecteLayout({
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
    </div>
  );
}
