import type { Metadata } from "next";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { getCurrentUser } from "@/lib/auth/dal";
import {
  compterInterventionsClient,
  listerInterventionsPassees,
} from "@/lib/db/queries/interventions";
import { CHEMIN_RESERVATION } from "@/components/layouts/site-navigation";

import { EnTeteEspace } from "../_components/en-tete-espace";
import { FiltrePeriode } from "../_components/filtre-periode";
import { InterventionsVue } from "../_components/interventions-vue";
import { PaginationPassees } from "../_components/pagination-passees";

export const metadata: Metadata = {
  title: "Mes interventions passées — HomeCycl'Home",
};

/// Onglet « Passées » — `US-INTERVENTIONS-LISTER-CLIENT-PASSEES`, écran **C10**.
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
/// par technicien, et le badge « PREMIÈRE INTERVENTION » — aucun critère
/// d'acceptation ne les demande, et [[maquettage]] §Notes portage classe déjà le
/// dernier parmi les inventions de la maquette. Le label « Client Premium » de
/// la barre latérale suit le même sort.
///
/// `searchParams` est une promesse en Next 16, et il est typé comme tel
/// (CLAUDE.md §TypeScript).
export default async function InterventionsPasseesPage({
  searchParams,
}: {
  searchParams: Promise<{ du?: string; au?: string; page?: string }>;
}) {
  const [user, parametres] = await Promise.all([
    getCurrentUser(),
    searchParams,
  ]);

  const [passees, compteurs] = await Promise.all([
    listerInterventionsPassees({
      clientId: user.id,
      ...(jour(parametres.du) ? { du: jour(parametres.du) } : {}),
      ...(jour(parametres.au) ? { au: jour(parametres.au) } : {}),
      page: Number(parametres.page) || 1,
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
          vide={{
            message: "Vous n'avez pas d'historique de rendez-vous.",
            href: CHEMIN_RESERVATION,
            libelle: "Réservez votre première intervention",
          }}
        />
      </NuqsAdapter>

      <PaginationPassees
        page={passees.page}
        pages={passees.pages}
        periode={{
          ...(parametres.du ? { du: parametres.du } : {}),
          ...(parametres.au ? { au: parametres.au } : {}),
        }}
      />
    </>
  );
}

/// `<input type="date">` rend `AAAA-MM-JJ`, ou une chaîne vide. Tout le reste
/// est ignoré plutôt que refusé : ces paramètres viennent de l'URL, donc de
/// n'importe qui, et une date illisible ne doit pas faire échouer la page - elle
/// doit simplement ne pas filtrer.
function jour(valeur: string | undefined): Date | undefined {
  if (!valeur || !/^\d{4}-\d{2}-\d{2}$/.test(valeur)) return undefined;
  const instant = new Date(`${valeur}T00:00:00.000Z`);
  return Number.isNaN(instant.getTime()) ? undefined : instant;
}
