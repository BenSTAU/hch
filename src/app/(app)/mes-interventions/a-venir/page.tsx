import type { Metadata } from "next";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { requireEspaceClient } from "@/lib/auth/permissions";
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
  title: "Mes interventions à venir - HomeCycl'Home",
};

/// Onglet « À venir » - `US-INTERVENTIONS-LISTER-CLIENT-A-VENIR`, écran **C8**.
///
/// Destination post-connexion du client ([[module-1-utilisateurs]] §287), et
/// c'est la DoD finale de la destination laissée provisoire par T-V3-03.
///
/// ⚠️ **`requireEspaceClient()` depuis T-V2-05 : un technicien et un
/// administrateur reçoivent 403.**
///
/// Cette page portait jusque-là un commentaire affirmant l'inverse, au motif que
/// « le cloisonnement de Constitution §3.1 porte sur les actes de gestion, pas
/// sur le fait d'être client ». C'était la lecture **étroite** de l'axiome,
/// celle de son paragraphe *Conséquence technique*. Sa **première phrase** pose
/// « trois rôles exclusifs … avec des parcours dédiés », et c'est elle qui fait
/// foi depuis la clarification datée du 2026-08-12 (Constitution §3.1, tableau
/// des surfaces), tranchée par Benjamin : « un technicien n'est pas un client ».
///
/// Le cloisonnement porte sur les **espaces de travail** : `/mon-compte/*` et
/// `/reserver` restent ouverts à tous les rôles, et deux tests le figent.
///
/// La garde vit dans la page et non dans `layout.tsx`, qui est partagé : le
/// Partial Rendering ne rejoue pas un layout en navigation client (CLAUDE.md
/// §Authentication). `src/proxy.ts` ne décide d'aucun rôle non plus - il
/// redirige sur l'absence de cookie, rien de plus.
export default async function InterventionsAVenirPage() {
  const user = await requireEspaceClient();

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
