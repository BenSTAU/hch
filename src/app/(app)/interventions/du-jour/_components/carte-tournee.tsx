"use client";

import { useEffect, useRef, useState } from "react";

import type { InterventionTournee } from "@/lib/db/queries/interventions";
import { formatHeure } from "@/lib/format";

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
/// ── La carte est MANIPULABLE, et ça décide de son traitement d'accessibilité
///
/// Arbitrage de Benjamin le 2026-08-12, en recette : le technicien doit pouvoir
/// se déplacer et zoomer. Ça la fait passer d'illustration à outil, et le
/// traitement bascule avec elle.
///
/// ⚠️ **Elle était `aria-hidden` et `inert`, et ce n'était pas un excès de
/// prudence** : `disableDefaultUI` plus `inert` étaient le correctif B2 de
/// l'agent testeur. L'API injecte ses propres commandes **focusables** dans le
/// conteneur, et sous un `aria-hidden` elles produisent `aria-hidden-focus`
/// (axe, wcag2a, SC 4.1.2) - atteignables au clavier, muettes au lecteur
/// d'écran, donc un arrêt sans annonce dans l'ordre de tabulation.
///
/// La faute n'était pas que les commandes existent, c'est qu'elles étaient
/// **cachées**. Une carte qu'on manipule doit au contraire être exposée : elle
/// porte donc un nom accessible, ses commandes sont rendues, et les raccourcis
/// clavier de l'API sont actifs. Reposer `aria-hidden` par-dessus ramènerait
/// exactement la violation B2.
///
/// RGAA A reste tenu sur l'**information** : un canevas de tuiles n'est pas
/// restituable à un lecteur d'écran, et la liste ci-contre porte intégralement
/// chaque adresse. La carte ajoute une lecture, elle n'en est jamais la seule.

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

/// 🐛 **`load` ne veut pas dire « l'API est prête », et c'est la cause des deux
/// pannes du 2026-08-12.**
///
/// Le module résolvait sa promesse sur l'événement `load` du `<script>`, puis
/// construisait la carte dans la foulée. Avec `loading=async`, cet événement se
/// déclenche quand l'amorce est **téléchargée**, pas quand l'API est montée :
/// `google.maps` existe alors partiellement. D'où, dans l'ordre où elles sont
/// tombées, `google.maps.Map is not a constructor` puis - après une première
/// tentative de correctif passant par `importLibrary` -
/// `google.maps.importLibrary is not a function`. Deux symptômes, une seule
/// cause : on lisait l'API trop tôt.
///
/// Le signal de disponibilité de cette forme d'URL est le paramètre
/// **`callback`** : l'API appelle ce rappel une fois montée, et tout ce que la
/// carte consomme (`Map`, `Marker`, `LatLngBounds`, `event`) est alors en place.
///
/// ⚠️ Distinct du défaut B1 corrigé en T-V2-01, qui donnait « google is not
/// defined » - là le global manquait entièrement. Les trois ne pouvaient se
/// voir qu'avec une clé renseignée, et il n'y en avait aucune avant le
/// 2026-08-12 : c'est très exactement le risque que la DoD de T-V2-01 nommait,
/// « le seul morceau du produit dont le chemin nominal n'a jamais tourné ».
function chargerMaps(cle: string): Promise<void> {
  if (chargement) return chargement;

  chargement = new Promise<void>((resoudre, rejeter) => {
    // 🐛 **On interroge la CAPACITÉ, pas la présence de la balise ni celle du
    // namespace.** Cette garde testait `document.getElementById(ID_SCRIPT)` et
    // résolvait aussitôt : après un échec, la balise morte restait dans le
    // `<head>`, la tentative suivante la retrouvait et résolvait sans rien
    // recharger - onglet bloqué sur « Chargement de la carte… » jusqu'au F5
    // (agent testeur, B1). Elle a ensuite testé `google.maps`, qui est vrai
    // AVANT que l'API soit utilisable : c'est le constructeur qu'on va appeler,
    // c'est donc lui qu'on vérifie.
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

    // `loading=async` est ce que l'API réclame depuis 2023 ; sans lui elle
    // écrit un avertissement de performance en console à chaque chargement. Et
    // il rend `callback` **obligatoire** : c'est le seul signal qui dise que
    // l'API est montée.
    // `language` et `region` : sans eux l'API rend ses commandes en anglais
    // (« Zoom in », « Toggle fullscreen »), donc des noms accessibles anglais
    // dans une application entièrement en français - RGAA A. Même défaut que le
    // « Close » du registry shadcn, traduit dans `ui/sheet.tsx`.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(cle)}&loading=async&language=fr&region=FR&callback=${NOM_RAPPEL}`;
    script.async = true;
    script.addEventListener("error", () => {
      // Rejouable : la promesse échouée est oubliée, la balise morte retirée et
      // le rappel global nettoyé. Il faut les trois - une promesse rejetée
      // reste rejetée pour tous ses futurs lecteurs, et un rappel laissé sur
      // `window` résoudrait la promesse de la tentative SUIVANTE.
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
  /// Quatrième raison de ne rien monter, ajoutée après le constat de l'agent
  /// testeur : le chargement a échoué.
  ///
  /// On mémorise **la signature qui a échoué**, pas un booléen. Deux raisons, et
  /// la seconde décide : la reprise devient gratuite - dès que la tournée bouge,
  /// la signature diffère et l'échec cesse de s'appliquer, ce qui est la
  /// promesse de reprise du module ; et surtout un booléen aurait exigé un
  /// `setEchec(false)` dans le corps de l'effet, que `react-hooks/
  /// set-state-in-effect` refuse à juste titre - c'est un rendu de plus à chaque
  /// passage.
  const [signatureEchouee, setSignatureEchouee] = useState<string | null>(null);

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
  // 🐛 **Construite sur la tournée ENTIÈRE, pas sur les seuls points.** C'est
  // B3 qui revenait par la porte de derrière : l'étiquette d'un pin est le rang
  // dans la tournée complète (`interventions.indexOf`), donc elle dépend aussi
  // des interventions **sans** point. Bâtie sur `points` seuls, la clé ne
  // bougeait pas quand le rafraîchissement de 30 s insérait un rendez-vous de
  // client pseudonymisé avant un pin existant : l'effet ne rejouait pas, et le
  // pin « 1 » désignait le deuxième rendez-vous de la journée. Une clé de
  // mémoïsation doit couvrir toute l'entrée dont dépend le rendu, pas la partie
  // qu'on a sous la main. Trouvé par l'agent testeur.
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
          // ⚠️ **Les commandes sont RENDUES, et les raccourcis clavier actifs.**
          // C'est l'inverse de ce que posait le correctif B2, et le motif a
          // changé avec le composant : une carte décorative sous `aria-hidden`
          // ne doit rien exposer de focusable, une carte qu'on manipule doit au
          // contraire être atteignable au clavier. Le wrapper n'est plus
          // masqué, donc `aria-hidden-focus` ne s'applique plus.
          //
          // On garde une carte SOBRE : ni Street View, ni sélecteur de type de
          // carte. Ni l'un ni l'autre ne sert une tournée, et chacun ajoute un
          // arrêt de tabulation.
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
            // 🐛 **Numéroté sur la tournée ENTIÈRE, pas sur les points
            // retenus.** L'index du tableau filtré était corrélable à rien : une
            // intervention sans point — client pseudonymisé — était sautée sans
            // laisser de trou, et le pin « 2 » désignait alors le TROISIÈME
            // rendez-vous de la journée. Constat de l'agent testeur (B3).
            //
            // La maquette numérote les pins et [[maquettage]] §Notes portage
            // relève « pins carte sans numéros » comme la divergence à corriger,
            // donc on les numérote — mais un numéro qui ment est pire qu'aucun.
            label: String(interventions.indexOf(intervention) + 1),
            // L'HEURE en tête : c'est le seul repère que la liste affiche aussi,
            // donc le seul par lequel le technicien relie un pin à une ligne.
            // La liste ne porte pas d'ordinal, la maquette n'en met pas.
            title: `${formatHeure(new Date(intervention.appointmentAt))} — ${intervention.forfait}, ${intervention.adresse.street}`,
          });

          bornes.extend(position);
        }

        carte.fitBounds(bornes);

        // 🐛 **Les positions DISTINCTES, pas le nombre de points.** La condition
        // portait sur `points.length === 1` : six rendez-vous à la même adresse
        // - cas courant en démonstration, et réel pour un immeuble ou une
        // entreprise - donnent six points **confondus**, donc une boîte de
        // surface nulle que `fitBounds` cadre au zoom maximal, sans que ce
        // repli ne se déclenche. Constaté en recette le 2026-08-12, sur la
        // première exécution avec une clé.
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

        // 🐛 **Sans cette ligne, « Chargement de la carte… » restait
        // indéfiniment.** Le `catch` journalisait et rien d'autre : `pret`
        // restait faux, donc le message promettait un chargement en cours qui
        // n'aurait jamais lieu. La liste servait bien de repli - la DoD était
        // tenue sur le fond - mais l'écran mentait. Trouvé par l'agent testeur.
        //
        // L'échec rend le MÊME résultat qu'une clé absente : la région se
        // retire. C'est le repli que la DoD nomme, et c'est un seul chemin de
        // code, pas un second.
        if (!annule) setSignatureEchouee(signature);
      });

    return () => {
      annule = true;
    };
    // `signature` et non `points` : un tableau neuf à chaque rendu relancerait
    // l'effet en boucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsApiKey, montrable, signature]);

  // Les QUATRE raisons de ne rien monter aboutissent ici, au même rendu : la
  // clé manque, aucune intervention n'a de point, le script n'a pas chargé.
  // La liste des interventions porte déjà l'adresse complète de chaque
  // rendez-vous - c'est le repli accessible qu'exige la DoD, et c'est la
  // surface principale de l'écran, pas un mode dégradé.
  if (!montrable || signatureEchouee === signature) return null;

  return (
    // `section` nommée et non plus un `div` masqué : la carte est manipulable
    // depuis le 2026-08-12, donc elle est un repère de la page. Sans nom
    // accessible, un lecteur d'écran annoncerait une région anonyme au milieu
    // de la tournée.
    //
    // ⚠️ Ne pas y remettre `aria-hidden` ni `inert`. Les commandes de zoom que
    // l'API injecte sont focusables : masquées, elles reproduisent
    // `aria-hidden-focus` (constat B2 de l'agent testeur, T-V2-01).
    // 🐛 **Hauteur FIXE, et non plus étirée sur la liste.** Le conteneur portait
    // `lg:h-auto lg:min-h-96` : sur une tournée de six rendez-vous il
    // s'allongeait sur toute la colonne, une bande étroite et haute que T1 ne
    // dessine nulle part - la maquette en fait un bloc, suivi de la prochaine
    // intervention. Constaté en recette le 2026-08-12.
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
