"use client";

import { Check, MapPin, Wrench } from "lucide-react";

import type { ForfaitPublic } from "@/lib/db/queries/forfaits";
import { formatDuree, formatPrixEuros } from "@/lib/format";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

/// Étape 1 du tunnel - écran **C2** (`c2-tunnel-forfait/code.html`).
///
///   · grille `md:grid-cols-3`, gouttière de bento **16 px** (`c2:151`) ;
///   · dalle `rounded-[24px]`, `p-6` (`padding-card` 24 px), colonne pleine
///     hauteur, filet transparent au repos (`c2:153`) ;
///   · pastille d'icône **48 px** `rounded-xl`, `mb-6` ;
///   · titre `headline-md` 24 px `mb-2`, prix `headline-sm` 20 px aligné sur la
///     ligne de base avec la durée en `body-sm`, `mb-6` ;
///   · état retenu : fond `primary-fixed` et `ring-4 ring-primary` (`c2:181`) ;
///   · pied de dalle `mt-auto w-full py-3 rounded-xl` (`c2:176`).
///
/// La maquette dessine des `<button>` dont l'un porte « Sélectionné » et pousse
/// la validation dans la barre basse. C'est un choix exclusif parmi n : le
/// motif ARIA correspondant est le groupe de boutons radio, qui donne la
/// navigation par flèches et l'annonce « 2 sur 3 » sans code (RGAA 7.1). Le
/// bouton radio lui-même est masqué visuellement, la dalle entière lui sert
/// d'étiquette, et l'état retenu se peint depuis `aria-checked` - un attribut
/// garanti par ARIA, là où un `data-*` dépend de la version de Radix.
///
///  1. **Les puces de prestation sont inventées** (`c2:162-175` : « 20 points
///     de contrôle », « 2 pneus urbains renforcés »). Aucune source. Le
///     catalogue porte `services.description`, alimenté par le seed de
///     T-V3-01 : c'est lui qui s'affiche, à la place et dans la géométrie de la
///     liste. Même arbitrage qu'en C1, pour le même motif - une puce inventée
///     sur un écran de tarifs est un engagement que personne n'a pris.
///  2. **Le badge « Le plus demandé »** (`c2:183-186`) suppose un marqueur
///     absent de `services`, et un catalogue de trois forfaits exactement.
///     Non porté, comme en C1.
///  3. **Une icône par forfait** (`search`, `build`, `cyclone`). `services` ne
///     porte aucune colonne d'icône et l'admin créera d'autres forfaits en V1 :
///     la pastille est conservée, son symbole est uniforme.
export function EtapeForfait({
  forfaits,
  forfaitId,
  onSelection,
  idTitre,
}: {
  forfaits: ForfaitPublic[];
  forfaitId: number | null;
  onSelection: (id: number) => void;
  /// Le titre de l'écran nomme le groupe : sans nom accessible, un lecteur
  /// d'écran annonce « groupe de boutons radio » sans dire de quoi.
  idTitre: string;
}) {
  return (
    <div className="flex flex-col">
      <RadioGroup
        aria-labelledby={idTitre}
        value={forfaitId === null ? "" : String(forfaitId)}
        onValueChange={(valeur) => {
          onSelection(Number(valeur));
        }}
        className="grid grid-cols-1 gap-4 md:grid-cols-3"
      >
        {forfaits.map((forfait) => {
          const id = `forfait-${String(forfait.id)}`;

          return (
            <Label
              key={forfait.id}
              htmlFor={id}
              className={cn(
                "flex h-full cursor-pointer flex-col items-start gap-0 rounded-[24px] border border-transparent bg-card p-6 text-left transition-colors",
                "hover:border-border",
                "has-[[aria-checked=true]]:bg-primary-fixed has-[[aria-checked=true]]:ring-4 has-[[aria-checked=true]]:ring-primary",
                "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
              )}
            >
              {/* `aria-labelledby` et non le seul `<label for>` : constaté au
                  navigateur, Chrome ne calcule **aucun** nom accessible pour un
                  `<button role="radio">` étiqueté par un `<label for>`, et la
                  liste s'annonce alors « bouton radio, 1 sur 3 » sans jamais
                  nommer le forfait. Le nom est composé des deux libellés
                  visibles, ce qui le garde utilisable au pilotage vocal. */}
              <RadioGroupItem
                id={id}
                value={String(forfait.id)}
                aria-labelledby={`${id}-label ${id}-prix`}
                className="sr-only"
              />

              <span className="mb-6 flex size-12 items-center justify-center rounded-xl bg-secondary text-primary">
                <Wrench aria-hidden="true" className="size-7" />
              </span>

              <span
                id={`${id}-label`}
                className="mb-2 font-heading text-2xl font-bold tracking-[-0.02em] text-foreground"
              >
                {forfait.label}
              </span>

              <span
                id={`${id}-prix`}
                className="mb-6 flex items-baseline gap-2"
              >
                <span className="font-heading text-xl font-bold tracking-[-0.01em] text-primary">
                  {formatPrixEuros(forfait.price)}
                </span>
                {/* Constitution §5.1 veut des tarifs « complets » : sans TTC, le
                    visiteur ne sait pas si une taxe s'ajoute au paiement. */}
                <span className="text-sm font-medium text-muted-foreground">
                  TTC / {formatDuree(forfait.duration)}
                </span>
              </span>

              {forfait.description ? (
                <span className="mb-8 flex-grow text-sm leading-[1.5] font-medium text-muted-foreground">
                  {forfait.description}
                </span>
              ) : (
                <span className="mb-8 flex-grow" />
              )}

              {/* Décoratif : l'état réel est porté par `aria-checked` du bouton
                  radio, qu'un lecteur d'écran annonce déjà. Le doubler en texte
                  ferait entendre « sélectionné » deux fois. */}
              <span
                aria-hidden="true"
                className={cn(
                  "mt-auto flex w-full items-center justify-center gap-2 rounded-xl py-3 text-center text-sm font-semibold tracking-[0.05em] transition-colors",
                  forfaitId === forfait.id
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-foreground",
                )}
              >
                {forfaitId === forfait.id ? (
                  <>
                    <Check className="size-4" />
                    Sélectionné
                  </>
                ) : (
                  "Sélectionner"
                )}
              </span>
            </Label>
          );
        })}
      </RadioGroup>

      {/* Bandeau de `c2:256-262`, géométrie conservée, texte refait.
          Il annonçait « déplacement inclus sur Lyon, Villeurbanne, Bron,
          Vénissieux et Caluire-et-Cuire » - deux communes hors de la zone
          seedée, même erreur qu'en C1 - puis « des frais kilométriques peuvent
          s'appliquer au-delà », qui contredit à la fois le prix figé
          (Constitution §4.1) et ce que la landing déjà livrée promet. */}
      <p className="mx-auto mt-12 flex max-w-3xl items-center gap-4 rounded-xl bg-secondary p-4 text-sm font-medium text-muted-foreground">
        <MapPin aria-hidden="true" className="size-6 shrink-0 text-primary" />
        <span>
          <strong className="font-semibold text-foreground">
            Déplacement compris
          </strong>{" "}
          dans le prix du forfait, sans supplément kilométrique. La couverture
          de votre adresse est vérifiée à l&apos;étape suivante.
        </span>
      </p>
    </div>
  );
}
