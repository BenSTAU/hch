"use client";

import { parseAsInteger, parseAsStringLiteral, useQueryState } from "nuqs";
import { useState, useTransition } from "react";

import { AddressAutocomplete } from "@/components/features/adresses/address-autocomplete";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { verifierAdresse } from "@/lib/actions/adresses/verifier-adresse";
import { reserver } from "@/lib/actions/interventions/reserver";
import type { ForfaitPublic } from "@/lib/db/queries/forfaits";
import type { SuggestionAdresse } from "@/lib/geo/ban";
import { cn } from "@/lib/utils";

import { EtapeCreneau } from "./etape-creneau";

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

  const [adresse, setAdresse] = useState<SuggestionAdresse | null>(null);
  const [zoneId, setZoneId] = useState<number | null>(null);
  const [creneau, setCreneau] = useState<string | null>(null);

  const [erreur, setErreur] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [enCours, demarrer] = useTransition();

  const forfait = forfaits.find((f) => f.id === forfaitId) ?? null;

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
            <Button
              type="button"
              className="rounded-xl"
              disabled={enCours}
              onClick={valider}
            >
              {enCours ? "Validation…" : "Valider ma réservation"}
            </Button>
          ) : (
            // La garde réelle vit dans la Server Action ; ce bloc-ci évite
            // seulement de présenter un bouton qui finirait en redirection.
            <div className="flex flex-col gap-3 rounded-2xl border p-6">
              <h2 className="text-lg font-semibold">
                Un compte est nécessaire pour valider
              </h2>
              <p className="text-sm text-muted-foreground">
                Votre sélection est conservée. Créez votre compte, activez-le
                depuis l&apos;email reçu, puis revenez ici pour confirmer.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild className="rounded-xl">
                  <a
                    href={`/inscription?next=${encodeURIComponent(RETOUR_TUNNEL)}`}
                  >
                    Créer mon compte
                  </a>
                </Button>
                <Button asChild variant="outline" className="rounded-xl">
                  <a
                    href={`/connexion?next=${encodeURIComponent(RETOUR_TUNNEL)}`}
                  >
                    J&apos;ai déjà un compte
                  </a>
                </Button>
              </div>
            </div>
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
