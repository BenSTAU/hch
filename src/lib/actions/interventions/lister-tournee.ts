"use server";

import { instantUtc, jourLocal } from "@/lib/creneaux/horaires";
import {
  listerTourneeDuJour,
  type InterventionTournee,
} from "@/lib/db/queries/interventions";
import { techActionClient } from "@/lib/safe-action";

/// Ce que l'écran reçoit, au rendu comme à chaque rafraîchissement.
export type Tournee = {
  interventions: InterventionTournee[];
  /// Minuit de la journée listée, en heure de Paris, sérialisé en ISO. Il
  /// voyage AVEC les interventions plutôt que d'être figé au rendu : un onglet
  /// resté ouvert bascule au jour suivant à minuit, et un titre figé
  /// afficherait la date d'hier au-dessus de la tournée d'aujourd'hui.
  debutJournee: string;
};

/// Rafraîchissement de la tournée du jour, la `queryFn` de l'écran **T1**.
/// Server Action et non Route Handler : CLAUDE.md §Data fetching interdit
/// qu'un Client Component lise par Route Handler.
///
/// `techActionClient` applique `requireTech()` en middleware. La garde de la
/// page ne couvre pas cette action, `src/proxy.ts` laissant passer
/// `Next-Action` : une Server Action exportée est un endpoint POST public
/// (ADR-006 v2), et sans cette garde un client authentifié lirait le nom, le
/// téléphone et l'adresse des clients d'un technicien.
///
/// ⚠️ **Aucune entrée, et c'est une propriété, pas une limite à lever.** Le
/// technicien vient de la SESSION : un `techId` en paramètre serait la tournée
/// d'autrui pour qui sait poster. Consulter d'autres journées est
/// `US-INTERVENTIONS-LISTER-TECH-A-VENIR`, en lecture RSC.
export const listerTournee = techActionClient.action(
  async ({ ctx }): Promise<Tournee> => {
    const jour = jourLocal(new Date());

    const interventions = await listerTourneeDuJour({
      techId: ctx.tech.id,
      jour,
    });

    return { interventions, debutJournee: instantUtc(jour, 0).toISOString() };
  },
);
