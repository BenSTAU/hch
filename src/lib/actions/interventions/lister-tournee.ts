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
  /// Minuit de la journée listée, en heure de Paris, sérialisé en ISO. Il sert
  /// au titre « Aujourd'hui — jeudi 13 août ».
  ///
  /// Il voyage AVEC les interventions plutôt que d'être figé au rendu de la
  /// page : la journée se recalcule à chaque appel, donc un onglet resté ouvert
  /// bascule au jour suivant à minuit. Un titre figé au chargement afficherait
  /// alors la date d'hier au-dessus de la tournée d'aujourd'hui.
  debutJournee: string;
};

/// Rafraîchissement de la tournée du jour — la `queryFn` de l'écran **T1**.
///
/// Server Action et non Route Handler, alors que l'appelant est un composant
/// client qui repolle toutes les 30 secondes : CLAUDE.md §Data fetching interdit
/// qu'un Client Component lise par Route Handler. Même montage que
/// `lister-creneaux.ts`, à une différence près — celle-ci est **gardée**.
///
/// ── Elle porte sa propre garde de rôle, et c'est une DoD à part entière
///
/// `techActionClient` applique `requireTech()` en middleware, donc avant la
/// validation. La garde de la page ne couvre pas cette action : `src/proxy.ts`
/// laisse passer `Next-Action` délibérément, et une Server Action exportée est
/// joignable depuis n'importe quelle route, y compris publique
/// (ADR-006 v2). Sans cette ligne, un client authentifié qui poste ici recevrait
/// le nom, le téléphone et l'adresse des clients d'un technicien.
///
/// ── Aucune entrée, et c'est le cloisonnement
///
/// Le technicien vient de la SESSION, jamais de la charge utile — un `techId`
/// en paramètre serait la tournée d'autrui pour qui sait poster. Et la journée
/// se recalcule ici plutôt que d'être reçue : elle n'est donc pas figée au
/// chargement de l'onglet, et une tournée laissée ouverte bascule d'elle-même
/// au jour suivant à minuit. Consulter une AUTRE journée est
/// `US-INTERVENTIONS-LISTER-TECH-A-VENIR`, v2.
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
