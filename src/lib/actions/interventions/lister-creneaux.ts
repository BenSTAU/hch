"use server";

import {
  affecterCreneaux,
  deriverCreneaux,
  HORIZON_JOURS,
} from "@/lib/creneaux/derivation";
import { db } from "@/lib/db/client";
import { listerTechniciensCharges } from "@/lib/db/queries/interventions";
import { lireHorairesSemaine } from "@/lib/db/queries/parametres";
import { actionClient } from "@/lib/safe-action";
import { listerCreneauxSchema } from "@/lib/validations/interventions";

/// Grille de créneaux disponibles — **ouverte au visiteur anonyme**.
///
/// Server Action et non Route Handler, alors que l'appelant est un composant
/// client qui rafraîchit toutes les 30 secondes : CLAUDE.md §Data fetching
/// interdit qu'un Client Component lise par Route Handler. C'est la voie que
/// TanStack Query consomme en `queryFn`.
///
/// Rien n'est stocké : le pool se recalcule à chaque appel
/// (Constitution §2.1, pas de table `availabilities`).

const MESSAGE_FORFAIT_INCONNU = "Ce forfait n'est plus proposé.";

export const listerCreneaux = actionClient
  .inputSchema(listerCreneauxSchema)
  .action(async ({ parsedInput: { serviceId, zoneId } }) => {
    const forfait = await db.service.findFirst({
      where: { id: serviceId, isActive: true },
      select: { duration: true },
    });

    // Un forfait retiré du catalogue entre l'ouverture du tunnel et ce
    // rafraîchissement : le refus est net, la grille ne se vide pas en silence.
    if (!forfait)
      return { ok: false as const, message: MESSAGE_FORFAIT_INCONNU };

    const maintenant = new Date();
    const jusqua = new Date(
      maintenant.getTime() + HORIZON_JOURS * 24 * 3_600_000,
    );

    const [{ horaires, clesInvalides }, techniciens] = await Promise.all([
      lireHorairesSemaine(),
      listerTechniciensCharges({ zoneId, depuis: maintenant, jusqua }),
    ]);

    if (clesInvalides.length > 0) {
      // Une journée fermée par une faute de frappe est indiscernable d'une
      // fermeture voulue côté client. La trace serveur est le seul endroit où
      // ça se voit.
      console.error(
        "[creneaux] horaires illisibles, journées fermées par défaut :",
        clesInvalides.join(", "),
      );
    }

    const grille = deriverCreneaux({
      horaires,
      dureeMinutes: forfait.duration,
      maintenant,
    });

    const disponibles = affecterCreneaux(grille, techniciens);

    // Seuls les débuts sortent, en ISO. Le technicien affecté reste au serveur :
    // le client n'en a pas besoin, et c'est un identifiant d'utilisateur. La
    // réservation le recalcule de toute façon.
    return {
      ok: true as const,
      creneaux: disponibles.map((creneau) => creneau.debut.toISOString()),
    };
  });
