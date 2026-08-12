import type { Metadata } from "next";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { requireEspaceClient } from "@/lib/auth/permissions";
import {
  compterInterventionsClient,
  listerInterventionsPassees,
} from "@/lib/db/queries/interventions";
import { lireJourCivil, lirePage } from "@/lib/interventions/fenetre";
import { CHEMIN_ESPACE_CLIENT_PASSEES } from "@/lib/routes";
import { FiltrePeriode } from "@/components/features/interventions/filtre-periode";
import { PaginationInterventions } from "@/components/features/interventions/pagination-interventions";
import { CHEMIN_RESERVATION } from "@/components/layouts/site-navigation";

import { EnTeteEspace } from "../_components/en-tete-espace";
import { InterventionsVue } from "../_components/interventions-vue";

export const metadata: Metadata = {
  title: "Mes interventions passées - HomeCycl'Home",
};

/// Onglet « Passées » - `US-INTERVENTIONS-LISTER-CLIENT-PASSEES`, écran **C10**.
///
/// Même coquille et même panneau que C8 : ce qui change est le filtre de statut
/// (`DONE`, `CANCELLED`), le tri (`appointment_at DESC`), la pagination et le
/// filtre par période. Les blocs de mutation du panneau s'effacent d'eux-mêmes,
/// gouvernés par le statut de la ligne et non par la route.
///
/// ── Ce qui n'est pas porté de C10
///
/// Les trois cartes de statistiques, « Exporter historique (PDF) », le
/// téléchargement de facture, « Réserver à nouveau », les filtres par statut et
/// par technicien, et le badge « PREMIÈRE INTERVENTION » - aucun critère
/// d'acceptation ne les demande, et [[maquettage]] §Notes portage classe déjà le
/// dernier parmi les inventions de la maquette. Le label « Client Premium » de
/// la barre latérale suit le même sort.
///
/// `searchParams` est une promesse en Next 16, et il est typé comme tel
/// (CLAUDE.md §TypeScript).
///
/// ⚠️ **`requireEspaceClient()` depuis T-V2-05** : un technicien et un
/// administrateur reçoivent 403. Motif complet sur la page voisine, `a-venir`.
export default async function InterventionsPasseesPage({
  searchParams,
}: {
  searchParams: Promise<{ du?: string; au?: string; page?: string }>;
}) {
  const [user, parametres] = await Promise.all([
    requireEspaceClient(),
    searchParams,
  ]);

  // 🐛 `lireJourCivil` remplace un parseur local qui construisait
  // `new Date(\`${valeur}T00:00:00.000Z\`)`, donc minuit **UTC** : le filtre
  // « du 11 août » écartait les rendez-vous du 11 entre 00 h 00 et 02 h 00 en
  // été. C'est le bug UTC de C10 versé dans [[points-ouverts-hch]] le
  // 2026-08-11, corrigé ici parce que T-V2-05 écrivait le parseur correct à
  // trois lignes de là, pour l'historique du technicien.
  const du = lireJourCivil(parametres.du);
  const au = lireJourCivil(parametres.au);

  const [passees, compteurs] = await Promise.all([
    listerInterventionsPassees({
      clientId: user.id,
      ...(du ? { du } : {}),
      ...(au ? { au } : {}),
      page: lirePage(parametres.page),
    }),
    compterInterventionsClient({ clientId: user.id }),
  ]);

  return (
    <>
      <EnTeteEspace
        sousTitre="Consultez l'historique de vos rendez-vous passés."
        actif="passees"
        compteurs={compteurs}
      />

      <NuqsAdapter>
        <FiltrePeriode />

        <InterventionsVue
          interventions={passees.interventions}
          // Aucun catalogue : rien n'est modifiable sur une intervention
          // terminale, et charger le catalogue produit ici serait une requête
          // pour un bloc que le panneau ne rendra pas.
          produits={[]}
          // Aucune ligne de cet onglet n'est annulable : le bloc ne se rend
          // jamais ici, et le contact n'a donc rien à alimenter. Le lire quand
          // même serait une requête pour un composant que le panneau écarte.
          contact={{ telephone: null, email: null }}
          maintenant={new Date()}
          vide={{
            message: "Vous n'avez pas d'historique de rendez-vous.",
            href: CHEMIN_RESERVATION,
            libelle: "Réservez votre première intervention",
          }}
        />
      </NuqsAdapter>

      <PaginationInterventions
        page={passees.page}
        pages={passees.pages}
        base={CHEMIN_ESPACE_CLIENT_PASSEES}
        periode={{
          ...(parametres.du ? { du: parametres.du } : {}),
          ...(parametres.au ? { au: parametres.au } : {}),
        }}
      />
    </>
  );
}
