"use client";

import { useEffect, useRef, useState } from "react";

import type { InterventionTournee } from "@/lib/db/queries/interventions";

/// Carte de la tournée — colonne droite de l'écran **T1**.
///
/// ── Pourquoi une carte Google ici, alors que le parcours client n'en a plus
///
/// [[adr-015-provider-carto|ADR-015 v2]] a retiré la cartographie du parcours
/// client — sa conséquence-titre écrit « zéro Maps JS, zéro clé, zéro quota et
/// zéro transfert hors UE sur **tout le parcours client** ». La vue technicien
/// n'était traitée nulle part, et Benjamin a tranché la carte le 2026-08-12
/// (cadrage du plancher V2, D5). Reviennent avec elle les exigences §D2 et §D3
/// de l'ADR : clé par environnement, **restriction par referer**, **alerte de
/// budget**, et mention du transfert hors UE dans la politique de
/// confidentialité.
///
/// ⚠️ **Cette décision ne vaut que pour T1.** L'étendre au tunnel ou à la
/// landing renverserait la conséquence-titre d'ADR-015 v2, et la landing est
/// publique et anonyme — le transfert concernerait des visiteurs qui n'ont rien
/// signé, et poserait la question d'un bandeau de consentement que le projet n'a
/// jamais instruite. C'est un ADR-015 v3, à instruire à part.
///
/// ── Trois raisons de ne rien monter, et toutes rendent la main à la liste
///
///   1. **La clé manque** (`HCH_MAPS_API_KEY` facultative) ;
///   2. **aucune intervention n'a de point** — `addresses.location` est NULLable
///      depuis la migration `relax_addresses_location`, la pseudonymisation le
///      remet à NULL avec la rue ;
///   3. **le script ne charge pas** — quota dépassé, referer refusé, réseau.
///
/// Les trois aboutissent au même rendu : rien. La liste des interventions porte
/// déjà l'adresse complète de chaque rendez-vous, elle est le repli accessible
/// qu'exige la DoD, et elle n'est pas un mode dégradé bricolé — c'est la surface
/// principale de l'écran.
///
/// ── La carte n'est jamais la seule voie vers l'information
///
/// `aria-hidden` : un canevas de tuiles n'est pas restituable à un lecteur
/// d'écran, et RGAA A exige que l'information existe ailleurs. Elle existe — la
/// liste la porte intégralement. Marquer la carte comme décorative est plus
/// honnête que lui coller un `alt` qui prétendrait la résumer.

/// Centre de repli — Lyon. Il ne sert que si `fitBounds` n'a rien à cadrer, cas
/// qui ne se produit pas puisqu'on ne monte pas la carte sans pin. Il évite un
/// centre à (0, 0), au large du golfe de Guinée.
const LYON = { lat: 45.764, lng: 4.8357 };

/// Zoom appliqué quand la tournée n'a qu'un seul point : `fitBounds` sur une
/// boîte de surface nulle zoome au maximum, et la carte devient illisible.
const ZOOM_POINT_UNIQUE = 14;

const ID_SCRIPT = "google-maps-js";

/// Charge le script Maps une seule fois par onglet.
///
/// Pas de `next/script` : il faut savoir **quand** l'API est prête pour
/// construire la carte, et la promesse ci-dessous se partage entre les montages
/// successifs du composant. Deux injections donneraient l'avertissement
/// « You have included the Google Maps JavaScript API multiple times ».
let chargement: Promise<void> | undefined;

function chargerMaps(cle: string): Promise<void> {
  if (chargement) return chargement;

  chargement = new Promise<void>((resoudre, rejeter) => {
    const existant = document.getElementById(ID_SCRIPT);
    if (existant) {
      resoudre();
      return;
    }

    const script = document.createElement("script");
    script.id = ID_SCRIPT;
    // `loading=async` est ce que l'API réclame depuis 2023 ; sans lui elle
    // écrit un avertissement de performance en console à chaque chargement.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(cle)}&loading=async`;
    script.async = true;
    script.addEventListener("load", () => {
      resoudre();
    });
    script.addEventListener("error", () => {
      // Rejouable : on oublie la promesse échouée, sinon un incident réseau
      // ponctuel condamnerait la carte pour toute la durée de l'onglet.
      chargement = undefined;
      rejeter(new Error("Script Google Maps injoignable."));
    });
    document.head.append(script);
  });

  return chargement;
}

export function CarteTournee({
  interventions,
  mapsApiKey,
}: {
  interventions: InterventionTournee[];
  mapsApiKey: string | null;
}) {
  const conteneur = useRef<HTMLDivElement | null>(null);
  const [pret, setPret] = useState(false);

  // ⚠️ **La garde de pin qu'exige la DoD.** Une adresse sans point ne produit
  // pas un marqueur à (0, 0) : elle ne produit pas de marqueur du tout. Son
  // intervention reste dans la liste, avec son adresse écrite.
  const points = interventions.filter(
    (intervention) => intervention.point !== null,
  );

  const montrable = mapsApiKey !== null && points.length > 0;

  // Signature stable des coordonnées : sans elle, l'effet se rejouerait à
  // chaque rafraîchissement de 30 s — donc reconstruirait la carte entière
  // toutes les 30 secondes, en perdant le zoom et le déplacement du technicien.
  const signature = points
    .map(
      (intervention) =>
        `${String(intervention.id)}:${String(intervention.point?.lat)},${String(intervention.point?.lon)}`,
    )
    .join("|");

  useEffect(() => {
    if (!montrable || !mapsApiKey) return;

    let annule = false;

    chargerMaps(mapsApiKey)
      .then(() => {
        if (annule || !conteneur.current) return;

        const carte = new google.maps.Map(conteneur.current, {
          center: LYON,
          zoom: ZOOM_POINT_UNIQUE,
          // Le technicien lit une position, il ne navigue pas : les contrôles
          // de Street View et de type de carte n'ajoutent que du bruit.
          streetViewControl: false,
          mapTypeControl: false,
        });

        const bornes = new google.maps.LatLngBounds();

        for (const [index, intervention] of points.entries()) {
          const point = intervention.point;
          if (!point) continue;

          const position = { lat: point.lat, lng: point.lon };

          new google.maps.Marker({
            position,
            map: carte,
            // Numérotés dans l'ordre de la tournée, qui est l'ordre
            // chronologique. La maquette les numérote ; [[maquettage]] §Notes
            // portage relève « pins carte sans numéros » comme la divergence à
            // corriger, donc on les numérote bien.
            label: String(index + 1),
            title: `${intervention.forfait} — ${intervention.adresse.street}`,
          });

          bornes.extend(position);
        }

        carte.fitBounds(bornes);

        // Un seul point : `fitBounds` cadre une boîte de surface nulle et zoome
        // au maximum. On rétablit une échelle lisible une fois le cadrage fait.
        if (points.length === 1) {
          google.maps.event.addListenerOnce(carte, "idle", () => {
            carte.setZoom(ZOOM_POINT_UNIQUE);
          });
        }

        setPret(true);
      })
      .catch((erreur: unknown) => {
        // Quota dépassé, referer refusé, réseau coupé. La liste reste, et le
        // serveur n'a rien à en dire : c'est un incident de navigateur.
        console.error("[carte] Google Maps non chargée :", erreur);
      });

    return () => {
      annule = true;
    };
    // `signature` et non `points` : un tableau neuf à chaque rendu relancerait
    // l'effet en boucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsApiKey, montrable, signature]);

  if (!montrable) return null;

  return (
    <div
      aria-hidden="true"
      className="relative h-64 shrink-0 overflow-hidden rounded-2xl border border-border bg-secondary lg:h-auto lg:min-h-96 lg:w-96"
    >
      <div ref={conteneur} className="absolute inset-0" />
      {/* Superposé plutôt qu'alterné : le conteneur de la carte doit exister ET
          avoir ses dimensions au moment où `new google.maps.Map` le reçoit. Le
          rendre conditionnellement donnerait une carte de hauteur nulle. */}
      {!pret && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Chargement de la carte…
        </p>
      )}
    </div>
  );
}
