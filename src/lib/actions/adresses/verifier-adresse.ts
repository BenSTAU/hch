"use server";

import { geocoderAdresse, type ResultatBan } from "@/lib/geo/ban";
import { trouverZoneCouvrante } from "@/lib/geo/postgis";
import { actionClient } from "@/lib/safe-action";
import { verifierAdresseSchema } from "@/lib/validations/adresses";

/// Vérification géographique d'une adresse — **ouverte au visiteur anonyme**.
///
/// `actionClient` et non `authActionClient` : `US-ADRESSE-SAISIR` s'exerce dans
/// le tunnel, où la réservation précède l'inscription (Constitution §3.2). Une
/// garde de session ici fermerait le tunnel au guest.
///
/// C'est le consommateur applicatif de `ST_Covers`, et le lieu où « les
/// `lon`/`lat` venus du client ne font jamais foi » devient exécutable.

/// Libellés de refus. Ils viennent de `US-ADRESSE-SAISIR` §Cas d'erreur et
/// distinguent deux situations que l'utilisateur répare différemment :
/// réessayer, ou corriger sa saisie.
const MESSAGE_INDISPONIBLE =
  "Service de géolocalisation temporairement indisponible — réessayez.";
const MESSAGE_INTROUVABLE = "Adresse introuvable — vérifiez les informations.";
const MESSAGE_HORS_ZONE = "Aucun service disponible à cette adresse.";

function messageEchecBan(resultat: Extract<ResultatBan<never>, { ok: false }>) {
  switch (resultat.reason) {
    case "indisponible":
      return MESSAGE_INDISPONIBLE;
    case "introuvable":
      return MESSAGE_INTROUVABLE;
    default: {
      const exhaustive: never = resultat.reason;
      return String(exhaustive);
    }
  }
}

export const verifierAdresse = actionClient
  .inputSchema(verifierAdresseSchema)
  .action(async ({ parsedInput }) => {
    // Le libellé est la SEULE donnée de la charge utile qui serve à décider.
    // `lon` et `lat` sont reçus — l'écran les a affichés — puis écartés : les
    // retenir permettrait de forger un point tombant dans une zone servie pour
    // une adresse qui n'y est pas.
    const geocodage = await geocoderAdresse(parsedInput.label);
    if (!geocodage.ok) {
      return { error: messageEchecBan(geocodage) };
    }

    const adresse = geocodage.data;
    const couverture = await trouverZoneCouvrante({
      lon: adresse.lon,
      lat: adresse.lat,
    });

    if (!couverture.ok) {
      // Pas de suggestion de repli, pas de « zone la plus proche » : hors zone
      // est un refus net (Constitution §2.2), et l'étape créneau reste bloquée.
      return { error: MESSAGE_HORS_ZONE, horsZone: true };
    }

    return {
      adresse,
      zoneId: couverture.zoneId,
      zoneName: couverture.zoneName,
    };
  });
