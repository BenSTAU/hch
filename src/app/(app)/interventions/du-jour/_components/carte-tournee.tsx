"use client";

import { useEffect, useRef, useState } from "react";

import type { InterventionTournee } from "@/lib/db/queries/interventions";
import { formatHeure } from "@/lib/format";

/// Carte de la tournée - colonne droite de l'écran **T1**, seule surface non
/// admin à porter Maps JS ([[adr-015-provider-carto|ADR-015 v2]], tranchage D5).
///
/// ── Quatre raisons de ne rien monter, et toutes rendent la main à la liste
///
///   1. la clé manque (`HCH_MAPS_API_KEY` est facultative) ;
///   2. aucune intervention n'a de point (`addresses.location` est NULLable) ;
///   3. le script ne charge pas (quota, referer refusé, réseau) ;
///   4. l'API a échoué sur cette tournée-ci (`signatureEchouee`).
///
/// Les quatre rendent `null`. La liste porte déjà l'adresse complète de chaque
/// rendez-vous : c'est le repli accessible qu'exige la DoD, et la surface
/// principale de l'écran.
///
/// ⚠️ **Ne jamais remettre `aria-hidden` ni `inert` sur la région.** La carte
/// est manipulable, donc ses commandes sont rendues et focusables : les masquer
/// reproduirait `aria-hidden-focus` (wcag2a, SC 4.1.2). Historique du
/// renversement dans TASKS T-V2-01 §Notes write-back.
///
/// ⚠️ Portée limitée à T1. L'étendre au tunnel ou à la landing est un ADR-015
/// v3, cf. [[points-ouverts-hch]].

/// Centre de repli — Lyon. Il ne sert que si `fitBounds` n'a rien à cadrer, cas
/// qui ne se produit pas puisqu'on ne monte pas la carte sans pin. Il évite un
/// centre à (0, 0), au large du golfe de Guinée.
const LYON = { lat: 45.764, lng: 4.8357 };

/// Zoom appliqué quand la tournée n'a qu'un seul point : `fitBounds` sur une
/// boîte de surface nulle zoome au maximum, et la carte devient illisible.
const ZOOM_POINT_UNIQUE = 14;

const ID_SCRIPT = "google-maps-js";

/// Nom du rappel global que l'API invoque quand elle est prête.
///
/// Il doit être joignable depuis `window` par son nom : c'est l'API qui
/// l'appelle, depuis son propre code, à partir de la chaîne passée en
/// paramètre d'URL.
const NOM_RAPPEL = "__hchMapsPret";

declare global {
  interface Window {
    __hchMapsPret?: () => void;
  }
}

/// Charge le script Maps une seule fois par onglet.
///
/// Pas de `next/script` : il faut savoir **quand** l'API est prête pour
/// construire la carte, et la promesse ci-dessous se partage entre les montages
/// successifs du composant. Deux injections donneraient l'avertissement
/// « You have included the Google Maps JavaScript API multiple times ».
let chargement: Promise<void> | undefined;

/// ⚠️ **L'événement `load` du script ne signale PAS que l'API est prête.** Avec
/// `loading=async` il se déclenche quand l'amorce est téléchargée, et
/// `google.maps` n'est alors que partiellement peuplé. Le seul signal de
/// disponibilité est le paramètre `callback`.
///
/// Trois pannes s'y sont succédé, récit dans TASKS T-V2-01 §Notes write-back.
function chargerMaps(cle: string): Promise<void> {
  if (chargement) return chargement;

  chargement = new Promise<void>((resoudre, rejeter) => {
    // On interroge le CONSTRUCTEUR qu'on va appeler, et non la balise ni le
    // namespace : `google.maps` est vrai avant que l'API soit utilisable.
    if (
      typeof google !== "undefined" &&
      typeof google.maps?.Map === "function"
    ) {
      resoudre();
      return;
    }

    // Reliquat d'une tentative échouée : il n'a jamais rien exposé, et le
    // laisser ferait rejouer exactement le même faux positif.
    document.getElementById(ID_SCRIPT)?.remove();

    const script = document.createElement("script");
    script.id = ID_SCRIPT;

    window[NOM_RAPPEL] = () => {
      delete window[NOM_RAPPEL];
      resoudre();
    };

    // `language` et `region` : sans eux les commandes s'appellent « Zoom in »,
    // donc des noms accessibles anglais dans une application française.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(cle)}&loading=async&language=fr&region=FR&callback=${NOM_RAPPEL}`;
    script.async = true;
    script.addEventListener("error", () => {
      // Les trois sont nécessaires à la reprise : une promesse rejetée le
      // reste, et un rappel laissé sur `window` résoudrait la tentative
      // suivante sans qu'aucun script n'ait chargé.
      chargement = undefined;
      delete window[NOM_RAPPEL];
      script.remove();
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
  /// La signature qui a échoué, pas un booléen : la reprise est alors gratuite
  /// dès que la tournée bouge, et un booléen exigerait un `setEchec(false)` dans
  /// le corps de l'effet, que `react-hooks/set-state-in-effect` refuse.
  const [signatureEchouee, setSignatureEchouee] = useState<string | null>(null);

  // ⚠️ **La garde de pin qu'exige la DoD.** Une adresse sans point ne produit
  // pas un marqueur à (0, 0) : elle ne produit pas de marqueur du tout. Son
  // intervention reste dans la liste, avec son adresse écrite.
  const points = interventions.filter(
    (intervention) => intervention.point !== null,
  );

  const montrable = mapsApiKey !== null && points.length > 0;

  // Sans elle, l'effet reconstruirait la carte toutes les 30 s et perdrait le
  // zoom du technicien.
  //
  // ⚠️ Sur `interventions` et NON sur `points` : l'étiquette d'un pin est le
  // rang dans la tournée complète, donc elle dépend aussi des interventions
  // sans point. Une clé doit couvrir toute l'entrée dont dépend le rendu.
  const signature = interventions
    .map(
      (intervention) =>
        `${String(intervention.id)}:${String(intervention.point?.lat)},${String(intervention.point?.lon)}`,
    )
    .join("|");

  // Combien d'endroits DIFFÉRENTS, et non combien de rendez-vous : plusieurs
  // interventions peuvent partager une adresse.
  const positionsDistinctes = new Set(
    points.map(
      (intervention) =>
        `${String(intervention.point?.lat)},${String(intervention.point?.lon)}`,
    ),
  ).size;

  useEffect(() => {
    if (!montrable || !mapsApiKey) return;

    let annule = false;

    chargerMaps(mapsApiKey)
      .then(() => {
        if (annule || !conteneur.current) return;

        const carte = new google.maps.Map(conteneur.current, {
          center: LYON,
          zoom: ZOOM_POINT_UNIQUE,
          // Commandes rendues et atteignables au clavier : la carte est un
          // outil, pas une illustration. Ni Street View ni type de carte, qui
          // ne servent pas une tournée et ajoutent un arrêt de tabulation.
          zoomControl: true,
          fullscreenControl: true,
          streetViewControl: false,
          mapTypeControl: false,
          // `cooperative` : la molette fait défiler la PAGE, et zoome seulement
          // avec Ctrl. Sans ça, une carte de 384 px au milieu d'une liste de
          // rendez-vous capture le défilement et piège le lecteur.
          gestureHandling: "cooperative",
        });

        const bornes = new google.maps.LatLngBounds();

        for (const intervention of points) {
          const point = intervention.point;
          if (!point) continue;

          const position = { lat: point.lat, lng: point.lon };

          new google.maps.Marker({
            position,
            map: carte,
            // ⚠️ Rang dans la tournée ENTIÈRE : une intervention sans point est
            // sautée sans laisser de trou, et un index sur le tableau filtré
            // désignerait la mauvaise ligne.
            label: String(interventions.indexOf(intervention) + 1),
            // L'heure en tête : seul repère commun au pin et à la ligne, la
            // liste ne portant pas d'ordinal.
            title: `${formatHeure(new Date(intervention.appointmentAt))} — ${intervention.forfait}, ${intervention.adresse.street}`,
          });

          bornes.extend(position);
        }

        carte.fitBounds(bornes);

        // Les positions DISTINCTES, pas le nombre de points : plusieurs
        // rendez-vous à une même adresse donnent aussi une boîte de surface
        // nulle, que `fitBounds` cadrerait au zoom maximal.
        if (positionsDistinctes === 1) {
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

        // Sans ça, « Chargement de la carte… » resterait indéfiniment. L'échec
        // rend le même résultat qu'une clé absente : la région se retire.
        if (!annule) setSignatureEchouee(signature);
      });

    return () => {
      annule = true;
    };
    // `signature` et non `points` : un tableau neuf à chaque rendu relancerait
    // l'effet en boucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsApiKey, montrable, signature]);

  // Les quatre raisons de ne rien monter aboutissent ici, au même rendu.
  if (!montrable || signatureEchouee === signature) return null;

  return (
    // Région NOMMÉE : sans nom accessible, un lecteur d'écran annoncerait une
    // région anonyme au milieu de la tournée. Hauteur fixe, la maquette en fait
    // un bloc suivi de la prochaine intervention et non une bande étirée.
    <section
      aria-label="Carte de la tournée"
      className="relative h-64 shrink-0 overflow-hidden rounded-2xl border border-border bg-secondary lg:h-[30rem]"
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
    </section>
  );
}
