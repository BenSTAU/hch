"use client";

import { ArrowLeft, ArrowRight, CircleCheckBig, RotateCcw } from "lucide-react";
import Link from "next/link";
import { parseAsInteger, parseAsStringLiteral, useQueryState } from "nuqs";
import {
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { verifierAdresse } from "@/lib/actions/adresses/verifier-adresse";
import { reserver } from "@/lib/actions/interventions/reserver";
import type { ForfaitPublic } from "@/lib/db/queries/forfaits";
import type { LignePanier, ProduitVendable } from "@/lib/db/queries/produits";
import { formatPrixEuros } from "@/lib/format";
import { espacePrincipal } from "@/components/layouts/site-navigation";

/// Repli quand l'appelant ne descend pas de destination : l'espace client, qui
/// est celle d'un visiteur anonyme - l'inscription de fin de tunnel crée un
/// `ROLE_CLIENT`. La prop reste facultative pour que les tests co-localisés,
/// qui montent le tunnel sans session, n'aient pas à la fournir.
const ESPACE_CLIENT_PAR_DEFAUT = espacePrincipal([]);
import type { SuggestionAdresse } from "@/lib/geo/ban";
import { cn } from "@/lib/utils";

import { EtapeAdresse, type RefusAdresse } from "./etape-adresse";
import { EtapeCreneau } from "./etape-creneau";
import { EtapeForfait } from "./etape-forfait";
import type { PhotoDeposee } from "./etape-photos";
import { CONTENEUR, ETAPES, TITRES, type Etape } from "./etapes";
import { Recapitulatif } from "./recapitulatif";
import {
  BOUTON_BARRE,
  LibelleBarre,
  TunnelBarreAction,
} from "./tunnel-barre-action";
import { TunnelStepper } from "./tunnel-stepper";

/// Tunnel de réservation - écrans **C2 à C5**.
///
/// Route **publique**, hors du matcher `/client/:path*` de `src/proxy.ts` : la
/// réservation précède l'inscription (Constitution §3.2). Un visiteur anonyme
/// compose son rendez-vous, et ne crée son compte qu'au moment de valider.
///
/// L'étape et le forfait vivent dans l'URL - le parcours est partageable et
/// survit à un rechargement, et c'est par là que la landing pré-sélectionne un
/// forfait. L'adresse et le créneau, eux, restent en mémoire : une adresse
/// postale dans une query string est une donnée personnelle qui finirait dans
/// les journaux du serveur et l'historique du navigateur.
///
/// Ce module orchestre, il ne dessine pas : chaque écran porte sa propre
/// géométrie, ses divergences de portage et son titre.

/// Destination de retour après création ou connexion de compte. Le
/// récapitulatif est restauré depuis l'état conservé côté navigateur.
const RETOUR_TUNNEL = "/reserver?etape=recapitulatif";

/// Clé de conservation du tunnel en cours.
///
/// `sessionStorage` et non `localStorage` : l'état meurt avec l'onglet. Il
/// porte une adresse postale, qui n'a pas à survivre à la visite.
const CLE_REPRISE = "hch:tunnel";

/// Magasin qui ne notifie jamais : la seule chose qu'on lui demande est de
/// distinguer le rendu serveur du rendu navigateur. Défini au niveau du module
/// pour que sa référence soit stable d'un rendu à l'autre.
const SANS_ABONNEMENT = () => () => undefined;

/// Un créneau retenu, **avec ce dont il a été dérivé**.
///
/// Constitution §2.1 : le pool se dérive à la volée, `planning(tech de la zone)
/// × durée(forfait)`. Un instant n'a donc de sens que pour le couple qui l'a
/// produit. Le stocker nu laissait un créneau survivre à un changement de
/// forfait ou d'adresse, et le récapitulatif engager sur un couple impossible.
type CreneauRetenu = {
  debut: string;
  serviceId: number;
  zoneId: number;
};

type EtatConserve = {
  /// Conservé ici **en plus** de l'URL. Le forfait vit dans la query string
  /// parce que le parcours est partageable, mais la destination de retour
  /// annoncée par C5 ne la porte pas : sans cette copie, revenir de
  /// `/connexion?next=…` affichait l'écran de reprise et imputait la perte à
  /// une ouverture cross-appareil qui n'avait pas eu lieu.
  forfaitId: number | null;
  adresse: SuggestionAdresse | null;
  zoneId: number | null;
  creneau: CreneauRetenu | null;
  photos: PhotoDeposee[];
  /// Identifiants et quantités seulement. Les prix se rejoignent à l'affichage
  /// depuis le catalogue rendu par le serveur, et se figent en base à la vente.
  panier: LignePanier[];
};

/// Fonction et non constante partagée : deux tunnels successifs dans le même
/// onglet ne doivent pas se passer le même tableau.
function etatVide(): EtatConserve {
  return {
    forfaitId: null,
    adresse: null,
    zoneId: null,
    creneau: null,
    photos: [],
    panier: [],
  };
}

/// Lu à l'initialisation et non dans un effet : un effet qui appelle `setState`
/// déclenche un rendu en cascade, que le compilateur React refuse.
///
/// Rend l'état vide côté serveur - `sessionStorage` n'y existe pas.
function lireEtatConserve(): EtatConserve {
  const vide = etatVide();
  if (typeof window === "undefined") return vide;

  try {
    const brut = window.sessionStorage.getItem(CLE_REPRISE);
    if (!brut) return vide;

    const repris = { ...vide, ...(JSON.parse(brut) as Partial<EtatConserve>) };

    // Un enregistrement d'une version antérieure porte `creneau` en chaîne
    // nue, sans le couple qui l'a dérivé. On ne peut pas le rattacher après
    // coup : il est ignoré, et le visiteur rechoisit un créneau.
    if (typeof repris.creneau !== "object") repris.creneau = null;

    // `apercu` est une URL d'objet (`blob:`), valable pour le seul document qui
    // l'a créée : après un rechargement elle pointe dans le vide. La conserver
    // afficherait une image cassée à la reprise. Le `url` rendu par le serveur,
    // lui, survit - c'est lui qui part à la validation.
    return {
      ...repris,
      photos: repris.photos.map((photo) => ({ ...photo, apercu: "" })),
    };
  } catch {
    // Donnée corrompue ou stockage refusé (navigation privée stricte) : on
    // repart d'un tunnel neuf plutôt que de casser l'écran.
    return vide;
  }
}

export function TunnelReservation({
  forfaits,
  produits,
  estConnecte,
  espace = ESPACE_CLIENT_PAR_DEFAUT,
}: {
  forfaits: ForfaitPublic[];
  produits: ProduitVendable[];
  estConnecte: boolean;
  /// Destination de la sortie de l'écran de confirmation, calculée au serveur
  /// depuis les rôles. Elle est facultative et retombe sur l'espace client :
  /// c'est la destination d'un visiteur anonyme, qui devient `ROLE_CLIENT` en
  /// s'inscrivant en fin de tunnel.
  espace?: { href: string; label: string };
}) {
  const [etape, setEtape] = useQueryState(
    "etape",
    parseAsStringLiteral(ETAPES).withDefault("forfait"),
  );
  const [forfaitUrl, setForfaitUrl] = useQueryState("forfait", parseAsInteger);

  // Conservé pendant l'aller-retour de création de compte : le visiteur part
  // s'inscrire, active, se connecte, et retrouve sa sélection. Le CRÉNEAU, lui,
  // n'est pas tenu - il est revalidé au retour, et la grille rafraîchie prend
  // le relais s'il est parti.
  const [conserve] = useState(lireEtatConserve);
  const [adresse, setAdresse] = useState<SuggestionAdresse | null>(
    conserve.adresse,
  );
  const [zoneId, setZoneId] = useState<number | null>(conserve.zoneId);
  const [creneau, setCreneau] = useState<CreneauRetenu | null>(
    conserve.creneau,
  );
  const [photos, setPhotos] = useState<PhotoDeposee[]>(conserve.photos);
  const [panier, setPanier] = useState<LignePanier[]>(conserve.panier);

  /// L'URL fait foi quand elle porte un forfait - c'est elle qui rend le
  /// parcours partageable, et c'est par elle que la landing pré-sélectionne.
  /// À défaut, l'état conservé prend le relais : la destination de retour
  /// annoncée par C5 ne porte pas de forfait, et sans ce repli le visiteur
  /// revenait de sa connexion sur un tunnel vide.
  ///
  /// Déduction, jamais recopie dans l'URL par un effet : un `setState` dans un
  /// effet est ce que le compilateur React refuse, et la recopie n'apporterait
  /// rien de plus qu'un paramètre d'affichage.
  const forfaitId = forfaitUrl ?? conserve.forfaitId;

  // ⚠️ **Le rendu du serveur et le premier rendu du navigateur doivent être
  // identiques**, et ils ne peuvent pas l'être : `sessionStorage` n'existe que
  // d'un côté, et c'est lui qui décide de l'étape affichée. React signalait la
  // divergence d'hydratation sur le `svg` du stepper - relevé dans le journal
  // du serveur pendant la barrière, jamais au build.
  //
  // `useSyncExternalStore` sur un magasin qui ne change jamais est le moyen
  // canonique de savoir qu'on est monté : il rend l'instantané SERVEUR pendant
  // l'hydratation, puis l'autre. Un effet qui poserait un booléen ferait la
  // même chose, mais par un `setState` synchrone dans un effet - ce que le
  // compilateur React refuse, et à juste titre.
  const monte = useSyncExternalStore(
    SANS_ABONNEMENT,
    () => true,
    () => false,
  );

  const [refusAdresse, setRefusAdresse] = useState<RefusAdresse | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [enCours, demarrer] = useTransition();

  const idTitre = useId();
  const forfait = forfaits.find((f) => f.id === forfaitId) ?? null;

  /// Le créneau retenu **s'il vaut encore**. Constitution §2.1 : il a été dérivé
  /// d'un couple `(forfait, zone)`, et il ne désigne plus rien dès que l'un des
  /// deux change. La cohérence se déduit ici, à chaque rendu, plutôt que de
  /// dépendre d'un gestionnaire qui penserait à le remettre à zéro - c'est un
  /// gestionnaire oublié qui laissait le récapitulatif engager sur un couple
  /// impossible.
  const creneauValide =
    creneau !== null &&
    creneau.serviceId === forfaitId &&
    creneau.zoneId === zoneId
      ? creneau.debut
      : null;

  // Écriture seule : aucun `setState`, donc aucun rendu en cascade.
  //
  // ⚠️ **Un tunnel validé n'a plus rien à reprendre**, et c'est ce même chemin
  // d'écriture qui l'inscrit - pas un gestionnaire de remise à zéro posé
  // ailleurs. Un gestionnaire s'oublie, une déduction non (mécanique de la note
  // (3) de PR #30). C'est un oubli de ce genre qui laissait les photos d'une
  // réservation validée revenir dans la suivante : une photo prise au domicile
  // d'un client ne doit pas pouvoir se rattacher à une intervention qu'elle ne
  // concerne pas.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(
        CLE_REPRISE,
        JSON.stringify(
          confirmation
            ? etatVide()
            : { forfaitId, adresse, zoneId, creneau, photos, panier },
        ),
      );
    } catch {
      // Stockage refusé : la reprise ne fonctionnera pas, le tunnel si.
    }
  }, [confirmation, forfaitId, adresse, zoneId, creneau, photos, panier]);

  // Tant qu'on n'est pas monté, on rend une attente - jamais un contenu qui
  // dépendrait de l'état conservé. Le serveur et l'hydratation produisent alors
  // exactement le même arbre, et le tunnel apparaît au rendu suivant.
  if (!monte) {
    return (
      <>
        <TunnelStepper courante={etape} />
        <main className="flex-grow pb-24">
          <div className={cn(CONTENEUR, "flex flex-col gap-4 py-12")}>
            <p role="status" className="sr-only">
              Chargement de votre réservation…
            </p>
            <Skeleton className="h-12 w-2/3" />
            <Skeleton className="h-72 w-full rounded-2xl" />
          </div>
        </main>
      </>
    );
  }

  /// Première étape dont les prérequis manquent. Elle borne la navigation : une
  /// URL forgée, un lien partagé ou un retour d'activation sur un autre appareil
  /// amènent au récapitulatif sans rien derrière, et l'écran doit le dire.
  const premiereIncomplete: Etape =
    forfait === null
      ? "forfait"
      : adresse === null || zoneId === null
        ? "adresse"
        : creneauValide === null
          ? "creneau"
          : "recapitulatif";

  const etapeAffichee: Etape =
    ETAPES.indexOf(etape) > ETAPES.indexOf(premiereIncomplete)
      ? premiereIncomplete
      : etape;

  const incomplete = etapeAffichee !== etape;

  function aller(cible: Etape) {
    setErreur(null);
    void setEtape(cible);
  }

  function verifier(suggestion: SuggestionAdresse) {
    setErreur(null);
    setRefusAdresse(null);
    setAdresse(null);
    setZoneId(null);

    demarrer(async () => {
      const resultat = await verifierAdresse(suggestion);

      if (resultat?.serverError) {
        setRefusAdresse({ message: resultat.serverError, horsZone: false });
        return;
      }

      const donnees = resultat?.data;
      if (!donnees) return;
      if (!donnees.ok) {
        setRefusAdresse({
          message: donnees.message,
          horsZone: donnees.horsZone,
        });
        return;
      }

      // On garde l'adresse renvoyée par le SERVEUR, pas celle qu'on a envoyée :
      // c'est elle qui a été re-géocodée.
      setAdresse(donnees.adresse);
      setZoneId(donnees.zoneId);
    });
  }

  function valider() {
    // `creneauValide` et non `creneau` : c'est ce qui empêche d'envoyer le
    // forfait courant avec un instant dérivé d'un autre. Le serveur refuserait
    // de toute façon, mais avec « ce créneau vient d'être réservé » - un
    // message faux, qui impute à un tiers un état que le tunnel a produit seul.
    if (!forfait || !adresse || creneauValide === null) return;
    setErreur(null);

    demarrer(async () => {
      const resultat = await reserver({
        serviceId: forfait.id,
        adresse,
        debut: creneauValide,
        photos: photos.map((photo) => photo.url),
        panier,
      });

      if (resultat?.validationErrors) {
        setErreur("Vérifiez les informations saisies.");
        return;
      }
      if (resultat?.serverError) {
        setErreur(resultat.serverError);
        return;
      }

      const donnees = resultat?.data;
      if (!donnees) return;

      if (!donnees.ok) {
        setErreur(donnees.message);
        // Le créneau est parti pendant la validation : on renvoie à la grille,
        // que le rafraîchissement vient de mettre à jour. C'est la forme
        // minimale des « alternatives proposées » de la SPEC - ce qui reste est
        // ce qui s'affiche.
        if (donnees.creneauPerdu) {
          setCreneau(null);
          void setEtape("creneau");
        }
        return;
      }

      setConfirmation({
        interventionId: donnees.interventionId,
        debut: donnees.debut,
        prix: donnees.prix,
      });
    });
  }

  if (confirmation) {
    return <EcranConfirmation confirmation={confirmation} espace={espace} />;
  }

  return (
    <>
      <TunnelStepper courante={etapeAffichee} />

      {/* `pb-24` et non les `pb-32` de la maquette (`c2:110`) : la barre basse
          mesure 73 px, 128 px de compensation laissaient 55 px de vide qui
          faisaient déborder l'étape créneau d'une hauteur de fenêtre. */}
      <main className="flex-grow pb-24">
        {erreur ? (
          <div className={cn(CONTENEUR, "pt-6")}>
            <p
              role="alert"
              className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive"
            >
              {erreur}
            </p>
          </div>
        ) : null}

        {incomplete ? (
          <EtatVide
            cible={etapeAffichee}
            onReprendre={() => {
              aller(etapeAffichee);
            }}
          />
        ) : null}

        {!incomplete && etapeAffichee === "forfait" ? (
          <div className={cn(CONTENEUR, "pt-8 pb-16")}>
            <div className="mx-auto mt-8 mb-16 max-w-3xl text-center">
              <h1
                id={idTitre}
                className="mb-4 font-heading text-4xl leading-[1.1] font-extrabold tracking-[-0.04em] md:text-5xl"
              >
                {TITRES.forfait}
              </h1>
              <p className="text-lg leading-[1.6] text-muted-foreground">
                Des tarifs transparents, sans surprise. Le déplacement du
                technicien est compris dans le prix du forfait.
              </p>
            </div>

            {forfaits.length > 0 ? (
              <EtapeForfait
                forfaits={forfaits}
                forfaitId={forfaitId}
                onSelection={(id) => {
                  void setForfaitUrl(id);
                  setErreur(null);
                }}
                idTitre={idTitre}
              />
            ) : (
              /* `US-FORFAIT-CONSULTER` §Cas limites : catalogue vide, aucun
                 appel à l'action de réservation. Le tunnel ne peut pas
                 commencer. */
              <p className="mx-auto max-w-3xl rounded-2xl border border-dashed border-border px-6 py-14 text-center text-muted-foreground">
                Aucun forfait n&apos;est proposé à la réservation pour le
                moment.
              </p>
            )}
          </div>
        ) : null}

        {!incomplete && etapeAffichee === "adresse" && forfait ? (
          <EtapeAdresse
            forfait={forfait}
            adresse={adresse}
            refus={refusAdresse}
            enCours={enCours}
            idTitre={idTitre}
            onSelectionner={verifier}
            onReinitialiser={() => {
              setRefusAdresse(null);
              setAdresse(null);
              setZoneId(null);
            }}
            onModifierForfait={() => {
              aller("forfait");
            }}
          />
        ) : null}

        {!incomplete &&
        etapeAffichee === "creneau" &&
        forfait &&
        adresse &&
        zoneId !== null ? (
          <EtapeCreneau
            forfait={forfait}
            adresse={adresse}
            zoneId={zoneId}
            creneauChoisi={creneauValide}
            idTitre={idTitre}
            // Le créneau est retenu AVEC le couple qui l'a dérivé : c'est ce
            // qui permet de le déclarer périmé au lieu de le croire sur parole.
            onChoisir={(debut) => {
              setCreneau({ debut, serviceId: forfait.id, zoneId });
            }}
            onModifierAdresse={() => {
              aller("adresse");
            }}
          />
        ) : null}

        {!incomplete &&
        etapeAffichee === "recapitulatif" &&
        forfait &&
        adresse &&
        creneauValide ? (
          <Recapitulatif
            forfait={forfait}
            adresse={adresse}
            creneau={creneauValide}
            photos={photos}
            onChangementPhotos={setPhotos}
            produits={produits}
            panier={panier}
            onChangementPanier={setPanier}
            estConnecte={estConnecte}
            enCours={enCours}
            onValider={valider}
            retour={RETOUR_TUNNEL}
            idTitre={idTitre}
          />
        ) : null}
      </main>

      {/* C5 n'a pas de barre basse : au récapitulatif, l'appel à l'action vit
          dans la colonne collante ([[maquettage]] §Notes portage). */}
      {!incomplete && etapeAffichee !== "recapitulatif" ? (
        <TunnelBarreAction>
          {etapeAffichee === "forfait" ? (
            <Button asChild variant="secondary" className={BOUTON_BARRE}>
              <Link href="/">
                <ArrowLeft aria-hidden="true" className="size-4" />
                <LibelleBarre court="Accueil" long="Retour à l'accueil" />
              </Link>
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              className={BOUTON_BARRE}
              onClick={() => {
                aller(etapeAffichee === "adresse" ? "forfait" : "adresse");
              }}
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              {etapeAffichee === "adresse" ? (
                <LibelleBarre court="Forfaits" long="Retour aux forfaits" />
              ) : (
                <LibelleBarre court="Adresse" long="Modifier l'adresse" />
              )}
            </Button>
          )}

          <Button
            type="button"
            className={BOUTON_BARRE}
            disabled={
              (etapeAffichee === "forfait" && forfait === null) ||
              (etapeAffichee === "adresse" && adresse === null) ||
              (etapeAffichee === "creneau" && creneauValide === null)
            }
            onClick={() => {
              aller(
                etapeAffichee === "forfait"
                  ? "adresse"
                  : etapeAffichee === "adresse"
                    ? "creneau"
                    : "recapitulatif",
              );
            }}
          >
            {etapeAffichee === "forfait" ? (
              "Continuer"
            ) : etapeAffichee === "adresse" ? (
              <LibelleBarre
                court="Créneaux"
                long="Continuer vers les créneaux"
              />
            ) : (
              <LibelleBarre
                court="Récapitulatif"
                long="Continuer vers le récapitulatif"
              />
            )}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Button>
        </TunnelBarreAction>
      ) : null}
    </>
  );
}

type Confirmation = {
  interventionId: number;
  debut: string;
  prix: string;
};

const DATE_COMPLETE = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "full",
  timeStyle: "short",
});

/// Fin du parcours (Constitution §1.2 : le tunnel se termine par une
/// confirmation automatique). Aucune maquette ne la dessine - C9 couvre
/// l'activation, pas la réservation -, la géométrie suit donc celle des dalles
/// du tunnel.
function EcranConfirmation({
  confirmation,
  espace,
}: {
  confirmation: Confirmation;
  espace: { href: string; label: string };
}) {
  return (
    <main className={cn(CONTENEUR, "flex flex-grow flex-col py-20")}>
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 rounded-2xl border border-border bg-card p-6 text-center shadow-sm md:p-12">
        <span className="flex size-16 items-center justify-center rounded-full bg-primary-fixed">
          <CircleCheckBig aria-hidden="true" className="size-8 text-primary" />
        </span>

        <h1 className="font-heading text-[2rem] leading-[1.2] font-bold tracking-[-0.03em]">
          Votre intervention est planifiée
        </h1>

        <p className="text-lg leading-[1.6] font-semibold first-letter:uppercase">
          {DATE_COMPLETE.format(new Date(confirmation.debut))}
        </p>
        <p className="text-lg leading-[1.6] text-muted-foreground">
          {formatPrixEuros(confirmation.prix)} TTC
        </p>

        <p className="text-base leading-[1.6] text-muted-foreground">
          Un email de confirmation vient de partir. Le règlement se fait auprès
          du technicien, sur place, à la fin de l&apos;intervention.
        </p>

        <Button asChild className="h-auto rounded-xl px-6 py-3">
          {/* La destination existe depuis T-V3-10. Elle visait
              `/client/interventions`, route qui n'a jamais été créée et que
              `src/proxy.ts` aurait de toute façon renvoyée vers `/connexion` :
              dernier geste du parcours de démonstration, et il tombait dans le
              vide. Relevé par Benjamin à la passe manuelle du 2026-08-10.

              🐛 Depuis T-V2-05 elle **suit le rôle** : `/reserver` reste
              ouverte à tous (Constitution §3.2), donc un technicien peut
              atteindre cet écran, et l'espace client lui répond désormais 403.
              Second lien mort de la même famille, trouvé par l'agent testeur. */}
          <Link href={espace.href}>{espace.label}</Link>
        </Button>
      </div>
    </main>
  );
}

/// Étape atteinte sans ses prérequis.
///
/// Le cas nominal n'est pas une URL forgée : c'est **le retour d'activation sur
/// un autre appareil**. Le lien part par email et s'ouvre souvent sur le
/// téléphone quand le tunnel a été composé sur l'ordinateur ; `sessionStorage`
/// est alors vide, par construction et non par bug. La limite se dit ici, elle
/// ne se déguise pas en page blanche.
function EtatVide({
  cible,
  onReprendre,
}: {
  cible: Etape;
  onReprendre: () => void;
}) {
  return (
    <div className={cn(CONTENEUR, "py-20")}>
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 rounded-2xl border border-dashed border-border bg-secondary p-6 text-center md:p-12">
        <span className="flex size-16 items-center justify-center rounded-full bg-background">
          <RotateCcw aria-hidden="true" className="size-7 text-primary" />
        </span>

        <h1 className="font-heading text-[2rem] leading-[1.2] font-bold tracking-[-0.03em]">
          Reprenons votre réservation
        </h1>

        <p className="text-base leading-[1.6] text-muted-foreground">
          Votre sélection n&apos;est plus en mémoire dans cet onglet. Elle est
          conservée le temps de la visite, sur le seul navigateur où vous
          l&apos;avez composée : si vous avez ouvert votre lien
          d&apos;activation sur un autre appareil, il faut la refaire ici. Rien
          n&apos;a été réservé, et aucun créneau n&apos;est bloqué.
        </p>

        <Button
          type="button"
          className="h-auto rounded-xl px-6 py-3"
          onClick={onReprendre}
        >
          {cible === "forfait"
            ? "Choisir un forfait"
            : cible === "adresse"
              ? "Saisir mon adresse"
              : "Choisir un créneau"}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </div>
  );
}
