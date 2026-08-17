"use client";

import { CheckCircle2, MapPinned, TriangleAlert } from "lucide-react";

import { AddressAutocomplete } from "@/components/features/adresses/address-autocomplete";
import type { ForfaitPublic } from "@/lib/db/queries/forfaits";
import { formatDuree, formatPrixEuros } from "@/lib/format";
import type { SuggestionAdresse } from "@/lib/geo/ban";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { CONTENEUR } from "./etapes";

/// Étape 2 du tunnel - écran **C3** (`c3-tunnel-adresse/code.html`).
///
///   · bandeau de rappel du forfait pleine largeur, `py-3`, filet bas
///     (`c3:143-147`) ;
///   · hero aligné à gauche, `mb-12 max-w-2xl`, titre `headline-xl` 48 px sur
///     desktop et 36 px en mobile (`c3:151`) ;
///   · bento `md:grid-cols-12`, gouttière 16 px, colonne de saisie sur **5**
///     et colonne de résultat sur **7** (`c3:155-157`, `c3:237`) ;
///   · dalles `rounded-2xl p-6 shadow-sm`, carte de résultat au filet gauche de
///     4 px (`c3:247`), pastille d'icône `rounded-full p-3`.
///
///  1. **La carte.** [[adr-015-provider-carto|ADR-015 v2]] retire la
///     cartographie du parcours client : l'iframe de `c3:239-245` disparaît, et
///     avec elle toute clé Google. La colonne de droite n'est pas laissée vide
///     pour autant - elle porte le résultat de la vérification, qui est
///     l'information que le visiteur attend. Aucun faux fond de carte : un
///     décor qui imite une carte laisserait croire qu'on situe l'adresse.
///  2. **La saisie manuelle** (`c3:190-219` : n°, voie, code postal, ville,
///     complément). Elle rouvrirait exactement la saisie libre non contrôlée
///     que Constitution §2.2 ferme, et que le filtre `housenumber` de la BAN
///     rend effective.
///  3. **Téléphone sur place et instructions technicien** (`c3:221-233`).
///     `addresses` ne porte aucune de ces deux colonnes au
///     [[mcd-dictionnaire|dictionnaire]] ; le téléphone, lui, est demandé une
///     seule fois, au compte (C5).
///  4. **Les fiches techniciens et leurs notes** (`c3:254-275` : « Marc L.,
///     4.9, 120 avis »). Il n'existe ni avis ni notation en v1, et l'affectation
///     est décidée à la réservation, pas ici.
///  5. **« M'alerter » sur la liste d'extension** (`c3:297-301`) et la liste de
///     communes desservies (`c3:290-296`, qui nomme Bron et Vénissieux, hors de
///     la zone seedée). Aucune US, et une zone est une géométrie, pas une liste
///     de communes (Constitution §2.2).
///  6. **« nos mécaniciens lyonnais »** (`c3:152`) devient « nos techniciens »,
///     règle transverse de [[maquettage]] §Notes portage.
///  7. **« Utiliser ma position actuelle »** (`c3:186`) : la géolocalisation du
///     navigateur donne un point, pas une adresse postale numérotée, et la
///     réservation exige la seconde.

export type RefusAdresse = { message: string; horsZone: boolean };

export function EtapeAdresse({
  forfait,
  adresse,
  refus,
  enCours,
  onSelectionner,
  onReinitialiser,
  onModifierForfait,
  idTitre,
}: {
  forfait: ForfaitPublic;
  /// Adresse **validée par le serveur**, donc couverte. Sa présence est ce qui
  /// autorise le pas suivant.
  adresse: SuggestionAdresse | null;
  refus: RefusAdresse | null;
  enCours: boolean;
  onSelectionner: (suggestion: SuggestionAdresse) => void;
  onReinitialiser: () => void;
  onModifierForfait: () => void;
  idTitre: string;
}) {
  return (
    <>
      <div className="border-b border-border bg-secondary">
        <div
          className={cn(
            CONTENEUR,
            "flex flex-wrap items-center justify-center gap-x-4 gap-y-1 py-3 text-sm",
          )}
        >
          <span className="font-medium text-foreground">
            {forfait.label} · {formatDuree(forfait.duration)} ·{" "}
            {formatPrixEuros(forfait.price)}
          </span>
          <Button
            type="button"
            variant="link"
            aria-label="Modifier le forfait"
            className="h-auto p-0 text-sm font-semibold tracking-[0.05em]"
            onClick={onModifierForfait}
          >
            {/* `aria-label` plutôt qu'un complément `sr-only` : le calcul du
                nom accessible concatène le texte et le `<span>` SANS séparateur,
                et le bouton s'annonçait « Modifierle forfait ». Constaté par le
                test. Le libellé visible reste contenu dans le nom, comme
                l'exige le critère « étiquette dans le nom ». */}
            Modifier
          </Button>
        </div>
      </div>

      <div className={cn(CONTENEUR, "pt-12 pb-16")}>
        <div className="mb-12 max-w-2xl">
          <h1
            id={idTitre}
            className="mb-4 font-heading text-4xl leading-[1.1] font-extrabold tracking-[-0.04em] text-primary md:text-5xl"
          >
            Où intervenons-nous ?
          </h1>
          <p className="text-lg leading-[1.6] text-muted-foreground">
            Saisissez l&apos;adresse où votre vélo doit être réparé. Nous
            vérifions immédiatement si elle se trouve dans la zone
            d&apos;intervention de nos techniciens.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
          <div className="md:col-span-5">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <AddressAutocomplete
                onSelectionner={onSelectionner}
                onReinitialiser={onReinitialiser}
                defaultValue={adresse?.label ?? ""}
              />
            </div>
          </div>

          <div className="md:col-span-7">
            <CarteResultat adresse={adresse} refus={refus} enCours={enCours} />
          </div>
        </div>
      </div>
    </>
  );
}

/// Colonne de droite : l'unique information que la maquette confiait à la carte.
function CarteResultat({
  adresse,
  refus,
  enCours,
}: {
  adresse: SuggestionAdresse | null;
  refus: RefusAdresse | null;
  enCours: boolean;
}) {
  if (enCours) {
    return (
      <Dalle ton="neutre">
        <p role="status" className="text-base text-muted-foreground">
          Vérification de la couverture…
        </p>
      </Dalle>
    );
  }

  if (refus) {
    return (
      <Dalle ton="refus">
        {/* Le repère live est porté par le CONTENEUR, jamais par le titre :
            `role="alert"` sur un `<h2>` écrase son rôle de titre, et `axe` le
            refuse (`aria-allowed-role`). Poser la région ici a l'avantage
            d'annoncer le motif du refus en plus de son intitulé.
            `alert` et non `status` : le visiteur vient d'agir et le refus
            interrompt son parcours. */}
        <div role="alert" className="flex items-start gap-4">
          <span className="shrink-0 rounded-full bg-destructive/10 p-3">
            <TriangleAlert
              aria-hidden="true"
              className="size-7 text-destructive"
            />
          </span>
          <div className="flex flex-col gap-2">
            <h2 className="font-heading text-xl font-bold tracking-[-0.01em] text-destructive">
              {refus.horsZone
                ? "Adresse hors de notre zone d'intervention"
                : "Vérification impossible"}
            </h2>
            <p className="text-base leading-[1.6] text-muted-foreground">
              {refus.message}
            </p>
            {refus.horsZone ? (
              <p className="text-base leading-[1.6] text-muted-foreground">
                Nos techniciens se déplacent sur Lyon et une partie des communes
                limitrophes. Essayez une autre adresse : la couverture se
                vérifie à l&apos;adresse près, pas à la commune.
              </p>
            ) : null}
          </div>
        </div>
      </Dalle>
    );
  }

  if (adresse) {
    return (
      <Dalle ton="succes">
        {/* Même motif que le refus : la région live est le conteneur, pas le
            titre. */}
        <div role="status" className="flex items-start gap-4">
          <span className="shrink-0 rounded-full bg-primary/10 p-3">
            <CheckCircle2 aria-hidden="true" className="size-7 text-primary" />
          </span>
          <div className="flex flex-col gap-2">
            <h2 className="font-heading text-xl font-bold tracking-[-0.01em] text-primary">
              Adresse dans notre zone d&apos;intervention
            </h2>
            <p className="text-base leading-[1.6] text-muted-foreground">
              {adresse.label}
            </p>
            <p className="text-base leading-[1.6] text-muted-foreground">
              Un technicien peut se déplacer à cette adresse. Continuez pour
              choisir votre créneau.
            </p>
          </div>
        </div>
      </Dalle>
    );
  }

  return (
    <Dalle ton="neutre">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-background">
          <MapPinned aria-hidden="true" className="size-7 text-primary" />
        </span>
        <p className="max-w-sm text-base leading-[1.6] text-muted-foreground">
          Choisissez une adresse dans la liste de suggestions : la couverture
          s&apos;affiche ici, sans créer de compte.
        </p>
      </div>
    </Dalle>
  );
}

/// Hauteur minimale de 280 px : sans elle, la colonne de droite s'effondre à la
/// hauteur de son texte et le bento se déséquilibre à chaque changement d'état.
function Dalle({
  ton,
  children,
}: {
  ton: "neutre" | "succes" | "refus";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[280px] flex-col justify-center rounded-2xl p-6",
        ton === "neutre" && "border border-dashed border-border bg-secondary",
        ton === "succes" &&
          "border border-l-4 border-border border-l-primary bg-card shadow-sm",
        ton === "refus" &&
          "border border-l-4 border-destructive/30 border-l-destructive bg-card shadow-sm",
      )}
    >
      {children}
    </div>
  );
}
