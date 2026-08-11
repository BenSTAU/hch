import type { Metadata } from "next";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { getCurrentUser } from "@/lib/auth/dal";
import {
  compterInterventionsClient,
  listerInterventionsAVenir,
} from "@/lib/db/queries/interventions";
import { lireContactSociete } from "@/lib/db/queries/parametres";
import { listProduitsVendables } from "@/lib/db/queries/produits";
import { CHEMIN_RESERVATION } from "@/components/layouts/site-navigation";

import { EnTeteEspace } from "../_components/en-tete-espace";
import { InterventionsVue } from "../_components/interventions-vue";

export const metadata: Metadata = {
  title: "Mes interventions à venir — HomeCycl'Home",
};

/// Onglet « À venir » — `US-INTERVENTIONS-LISTER-CLIENT-A-VENIR`, écran **C8**.
///
/// Destination post-connexion du client ([[module-1-utilisateurs]] §287), et
/// c'est la DoD finale de la destination laissée provisoire par T-V3-03.
///
/// **Aucune garde de rôle.** La page exige une session — `getCurrentUser`
/// redirige sinon — et filtre sur `clientId = user.id`. Un administrateur ou un
/// technicien qui a réservé pour lui-même y voit ses propres rendez-vous, ce qui
/// est correct : le cloisonnement de Constitution §3.1 porte sur les actes de
/// gestion, pas sur le fait d'être client. Même régime que les Server Actions
/// produits, qui passent par `authActionClient` sans exiger `ROLE_CLIENT`.
///
/// `src/proxy.ts` couvre `/mes-interventions/:path*` depuis cette tâche, mais il
/// ne fait que rediriger sur l'absence de cookie : c'est la lecture ci-dessous
/// qui refuse réellement.
export default async function InterventionsAVenirPage() {
  const user = await getCurrentUser();

  // Quatre lectures indépendantes, donc en parallèle et jamais en cascade. Le
  // catalogue alimente le bloc T+n du panneau, le contact alimente son bloc
  // d'annulation : ils sont lus ici parce que le panneau est un composant
  // client, qui ne peut pas interroger la base.
  const [interventions, produits, compteurs, contact] = await Promise.all([
    listerInterventionsAVenir({ clientId: user.id }),
    listProduitsVendables(),
    compterInterventionsClient({ clientId: user.id }),
    lireContactSociete(),
  ]);

  // L'horloge est fixée **une fois**, au rendu serveur, et descend en prop. Le
  // chip « Dans X jours » et la fenêtre d'annulation en dépendent tous les
  // deux : lus dans le composant client, ils rendraient une valeur au serveur
  // et une autre à l'hydratation.
  const maintenant = new Date();

  return (
    <>
      <EnTeteEspace
        sousTitre="Consultez, modifiez ou annulez vos rendez-vous à venir."
        actif="a-venir"
        compteurs={compteurs}
      />

      <NuqsAdapter>
        <InterventionsVue
          interventions={interventions}
          produits={produits}
          contact={contact}
          maintenant={maintenant}
          vide={{
            // Libellé de l'US §Cas nominal, au cadratin dans la SPEC et au
            // point ici (CLAUDE.md §Typographie). Écart signalé en PR.
            message: "Vous n'avez pas de rendez-vous prévu.",
            href: CHEMIN_RESERVATION,
            libelle: "Réserver un créneau",
          }}
        />
      </NuqsAdapter>
    </>
  );
}
