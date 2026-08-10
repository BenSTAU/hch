"use client";

import { parseAsInteger, parseAsStringLiteral, useQueryState } from "nuqs";
import { useEffect, useState, useTransition } from "react";

import { AddressAutocomplete } from "@/components/features/adresses/address-autocomplete";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { verifierAdresse } from "@/lib/actions/adresses/verifier-adresse";
import { reserver } from "@/lib/actions/interventions/reserver";
import type { ForfaitPublic } from "@/lib/db/queries/forfaits";
import type { SuggestionAdresse } from "@/lib/geo/ban";
import { cn } from "@/lib/utils";

import { EtapeCoordonnees } from "./etape-coordonnees";
import { EtapeCreneau } from "./etape-creneau";
import { EtapePhotos, type PhotoDeposee } from "./etape-photos";

/// Tunnel de réservation — écrans **C2 à C5**.
///
/// Route **publique**, hors du matcher `/client/:path*` de `src/proxy.ts` : la
/// réservation précède l'inscription (Constitution §3.2). Un visiteur anonyme
/// va jusqu'au bout et ne crée son compte qu'ensuite, s'il le souhaite.
///
/// L'étape et le forfait vivent dans l'URL — le parcours est partageable et
/// survit à un rechargement, et c'est par là que la landing pré-sélectionne un
/// forfait. L'adresse et le créneau, eux, restent en mémoire : une adresse
/// postale dans une query string est une donnée personnelle qui finirait dans
/// les journaux du serveur et l'historique du navigateur.

const ETAPES = ["forfait", "adresse", "creneau", "recapitulatif"] as const;
type Etape = (typeof ETAPES)[number];

const LIBELLES: Record<Etape, string> = {
  forfait: "Choisir une prestation",
  adresse: "Où intervenons-nous ?",
  creneau: "Choisir un créneau",
  recapitulatif: "Valider la réservation",
};

type Confirmation = {
  interventionId: number;
  debut: string;
  prix: string;
};

/// Destination de retour après création ou connexion de compte. Le
/// récapitulatif est restauré depuis l'état conservé côté navigateur.
const RETOUR_TUNNEL = "/reserver?etape=recapitulatif";

/// Clé de conservation du tunnel en cours.
///
/// `sessionStorage` et non `localStorage` : l'état meurt avec l'onglet. Il
/// porte une adresse postale, qui n'a pas à survivre à la visite.
const CLE_REPRISE = "hch:tunnel";

type EtatConserve = {
  adresse: SuggestionAdresse | null;
  zoneId: number | null;
  creneau: string | null;
  photos: PhotoDeposee[];
};

/// Lu à l'initialisation et non dans un effet : un effet qui appelle `setState`
/// déclenche un rendu en cascade, que le compilateur React refuse.
///
/// Rend l'état vide côté serveur — `sessionStorage` n'y existe pas.
function lireEtatConserve(): EtatConserve {
  const vide: EtatConserve = {
    adresse: null,
    zoneId: null,
    creneau: null,
    photos: [],
  };
  if (typeof window === "undefined") return vide;

  try {
    const brut = window.sessionStorage.getItem(CLE_REPRISE);
    return brut
      ? { ...vide, ...(JSON.parse(brut) as Partial<EtatConserve>) }
      : vide;
  } catch {
    // Donnée corrompue ou stockage refusé (navigation privée stricte) : on
    // repart d'un tunnel neuf plutôt que de casser l'écran.
    return vide;
  }
}

const dateComplete = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "full",
  timeStyle: "short",
});

export function TunnelReservation({
  forfaits,
  estConnecte,
}: {
  forfaits: ForfaitPublic[];
  estConnecte: boolean;
}) {
  const [etape, setEtape] = useQueryState(
    "etape",
    parseAsStringLiteral(ETAPES).withDefault("forfait"),
  );
  const [forfaitId, setForfaitId] = useQueryState("forfait", parseAsInteger);

  // Conservé pendant l'aller-retour de création de compte : le visiteur part
  // s'inscrire, active, se connecte, et retrouve sa sélection. Le CRÉNEAU, lui,
  // n'est pas tenu — il est revalidé au retour, et la grille rafraîchie prend
  // le relais s'il est parti.
  const [conserve] = useState(lireEtatConserve);
  const [adresse, setAdresse] = useState<SuggestionAdresse | null>(
    conserve.adresse,
  );
  const [zoneId, setZoneId] = useState<number | null>(conserve.zoneId);
  const [creneau, setCreneau] = useState<string | null>(conserve.creneau);
  const [photos, setPhotos] = useState<PhotoDeposee[]>(conserve.photos);

  const [erreur, setErreur] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [enCours, demarrer] = useTransition();

  const forfait = forfaits.find((f) => f.id === forfaitId) ?? null;

  // Écriture seule : aucun `setState`, donc aucun rendu en cascade.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(
        CLE_REPRISE,
        JSON.stringify({ adresse, zoneId, creneau, photos }),
      );
    } catch {
      // Stockage refusé : la reprise ne fonctionnera pas, le tunnel si.
    }
  }, [adresse, zoneId, creneau, photos]);

  function choisirForfait(id: number) {
    void setForfaitId(id);
    void setEtape("adresse");
    setErreur(null);
  }

  function verifier(suggestion: SuggestionAdresse) {
    setErreur(null);
    demarrer(async () => {
      const resultat = await verifierAdresse(suggestion);

      if (resultat?.serverError) {
        setErreur(resultat.serverError);
        return;
      }

      const donnees = resultat?.data;
      if (!donnees) return;
      if (!donnees.ok) {
        setErreur(donnees.message);
        return;
      }

      // On garde l'adresse renvoyée par le SERVEUR, pas celle qu'on a envoyée :
      // c'est elle qui a été re-géocodée.
      setAdresse(donnees.adresse);
      setZoneId(donnees.zoneId);
      void setEtape("creneau");
    });
  }

  function valider() {
    if (!forfait || !adresse || !creneau) return;
    setErreur(null);

    demarrer(async () => {
      const resultat = await reserver({
        serviceId: forfait.id,
        adresse,
        debut: creneau,
        photos: photos.map((photo) => photo.url),
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
        // minimale des « alternatives proposées » de la SPEC — ce qui reste est
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
    return (
      <section className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-12">
        <h1 className="text-3xl font-bold">Votre intervention est planifiée</h1>
        <p className="text-muted-foreground">
          {dateComplete.format(new Date(confirmation.debut))} —{" "}
          {confirmation.prix} € TTC
        </p>
        <p>
          Un email de confirmation vient de partir. Le règlement se fait auprès
          du technicien, sur place, à la fin de l&apos;intervention.
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">{LIBELLES[etape]}</h1>
        <ol className="flex gap-2 text-sm text-muted-foreground">
          {ETAPES.map((nom, index) => (
            <li
              key={nom}
              aria-current={nom === etape ? "step" : undefined}
              className={cn(nom === etape && "font-semibold text-foreground")}
            >
              {index + 1}. {LIBELLES[nom]}
            </li>
          ))}
        </ol>
      </header>

      {erreur && (
        <p role="alert" className="text-sm text-destructive">
          {erreur}
        </p>
      )}

      {etape === "forfait" && (
        <ul className="grid gap-4 sm:grid-cols-2">
          {forfaits.map((f) => (
            <li key={f.id}>
              <Card className="flex h-full flex-col gap-3 p-6">
                <h2 className="text-xl font-semibold">{f.label}</h2>
                {f.description && (
                  <p className="text-sm text-muted-foreground">
                    {f.description}
                  </p>
                )}
                <p className="text-sm">
                  {f.duration} min · {f.price} € TTC
                </p>
                <Button
                  type="button"
                  className="mt-auto rounded-xl"
                  onClick={() => {
                    choisirForfait(f.id);
                  }}
                >
                  Choisir {f.label}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {etape === "adresse" && (
        <div className="flex flex-col gap-4">
          <AddressAutocomplete
            onSelectionner={verifier}
            onReinitialiser={() => {
              setErreur(null);
            }}
          />
          {enCours && (
            <p role="status" className="text-sm text-muted-foreground">
              Vérification de la couverture…
            </p>
          )}
        </div>
      )}

      {etape === "creneau" && forfait && zoneId !== null && (
        <EtapeCreneau
          serviceId={forfait.id}
          zoneId={zoneId}
          creneauChoisi={creneau}
          onChoisir={(debut) => {
            setCreneau(debut);
            void setEtape("recapitulatif");
          }}
        />
      )}

      {etape === "recapitulatif" && forfait && adresse && creneau && (
        <div className="flex flex-col gap-6">
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="font-semibold">Prestation</dt>
              <dd>
                {forfait.label} — {forfait.duration} min, {forfait.price} € TTC
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Adresse</dt>
              <dd>{adresse.label}</dd>
            </div>
            <div>
              <dt className="font-semibold">Créneau</dt>
              <dd>{dateComplete.format(new Date(creneau))}</dd>
            </div>
          </dl>

          {estConnecte ? (
            <>
              <EtapePhotos photos={photos} onChangement={setPhotos} />

              <Button
                type="button"
                className="rounded-xl"
                disabled={enCours}
                onClick={valider}
              >
                {enCours ? "Validation…" : "Valider ma réservation"}
              </Button>
            </>
          ) : (
            // Les photos n'apparaissent qu'une fois connecté : leur dépôt exige
            // une session, et proposer un champ qui refuserait le fichier serait
            // une promesse qu'on ne tient pas.
            //
            // La garde réelle de la validation vit dans la Server Action ; ce
            // bloc-ci évite seulement d'afficher un bouton qui finirait en
            // redirection.
            <EtapeCoordonnees retour={RETOUR_TUNNEL} />
          )}

          <p className="text-xs text-muted-foreground">
            Le paiement se fait auprès du technicien, sur place, après
            l&apos;intervention.
          </p>
        </div>
      )}
    </section>
  );
}
