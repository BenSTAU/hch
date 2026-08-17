import type { Metadata } from "next";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { requireEspaceClient } from "@/lib/auth/permissions";
import { listerCyclesDuClient } from "@/lib/db/queries/cycles";
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
/// Destination post-connexion du client ([[module-1-utilisateurs]] §287).
///
/// ⚠️ **`requireEspaceClient()` : un technicien et un administrateur reçoivent
/// 403.** Constitution §3.1 pose trois rôles exclusifs avec des parcours
/// dédiés, amendée le 2026-08-14 en granularité par route.
///
/// La garde vit dans la page et non dans `layout.tsx`, qui est partagé : le
/// Partial Rendering ne rejoue pas un layout en navigation client (CLAUDE.md
/// §Authentication). `src/proxy.ts` ne décide d'aucun rôle non plus.
export default async function InterventionsAVenirPage() {
  const user = await requireEspaceClient();

  // Cinq lectures indépendantes, donc en parallèle et jamais en cascade. Le
  // catalogue alimente le bloc T+n du panneau, les vélos son sélecteur de
  // rattachement, le contact son bloc d'annulation : ils sont lus ici parce que
  // le panneau est un composant client, qui ne peut pas interroger la base.
  const [interventions, produits, cycles, compteurs, contact] =
    await Promise.all([
      listerInterventionsAVenir({ clientId: user.id }),
      listProduitsVendables(),
      listerCyclesDuClient({ userId: user.id }),
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
          cycles={cycles}
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
