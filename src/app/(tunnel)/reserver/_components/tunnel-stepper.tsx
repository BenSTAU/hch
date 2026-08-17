import { Check, X } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

import { CONTENEUR, ETAPES, ETIQUETTES, type Etape } from "./etapes";

/// Barre d'étapes du tunnel - en-tête des quatre écrans C2 à C5.
///
///   · barre `surface-container-low` sur toute la largeur, `py-4`, gouttières
///     20 / 64 px, contenu centré dans `max-w-7xl` ;
///   · pastilles de **32 px** (`size-8`) rondes, `gap-2` avec leur libellé,
///     `gap-8` entre les pas ;
///   · pas courant en `border-b-2 border-primary pb-2`, libellés en `label-md`
///     (14 px, semi-bold, interlettrage +0,05em) ;
///   · sous `lg`, la maquette replie tout en « Forfait (1/4) » (`c2:138-141`).
///
///  1. **`sticky` et non `fixed`.** Même rendu, mais `fixed` obligerait à
///     compenser la hauteur par un `pt-24` en dur (`c2:110`) qui devient faux
///     dès que la barre change, et qui masque le contenu au zoom 200 % (RGAA A).
///     Précédent posé par `SiteHeader` en T-V3-13, même motif.
///  2. **Les quatre maquettes portent quatre barres différentes** - C2 des
///     libellés, C3 des icônes plus le mot « Réservation », C4 la marque et des
///     numéros nus avec un bouton d'aide, C5 des pastilles numérotées légendées
///     dessous. Aucune n'est « la » barre du tunnel. Celle-ci retient la forme
///     de C2, la plus explicite, et la tient sur les quatre écrans : une barre
///     de progression qui change de langage à chaque pas ne se lit plus comme
///     une progression.
///
/// Les pas franchis ne sont **pas cliquables**, contrairement aux `<a href="#">`
/// de `c5:128-152`. Revenir en arrière passe par « Retour », qui repose la
/// question de la validité de l'état ; un saut direct au pas 3 depuis le pas 1
/// afficherait une grille de créneaux sans adresse.
export function TunnelStepper({ courante }: { courante: Etape }) {
  const rang = ETAPES.indexOf(courante);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-secondary">
      <div className={cn(CONTENEUR, "relative flex items-center py-4")}>
        {/* `absolute` pour que le stepper reste centré sur la page et non sur
            l'espace qui lui reste, comme dans la maquette. */}
        <Link
          href="/"
          className="absolute left-5 flex size-10 items-center justify-center rounded-full text-primary transition-colors hover:bg-background focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none md:left-16"
        >
          <X aria-hidden="true" className="size-5" />
          <span className="sr-only">Quitter la réservation</span>
        </Link>

        <nav aria-label="Progression de la réservation" className="mx-auto">
          <ol className="hidden items-center gap-8 lg:flex">
            {ETAPES.map((etape, index) => {
              const franchie = index < rang;
              const active = index === rang;

              return (
                <li
                  key={etape}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "flex items-center gap-2 pb-2 text-sm tracking-[0.05em]",
                    active
                      ? "border-b-2 border-primary font-bold text-primary"
                      : franchie
                        ? "font-semibold text-primary"
                        : "font-semibold text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 items-center justify-center rounded-full text-sm font-bold",
                      franchie || active
                        ? "bg-primary text-primary-foreground"
                        : "border border-input text-muted-foreground",
                    )}
                  >
                    {franchie ? (
                      <>
                        <Check aria-hidden="true" className="size-4" />
                        {/* Sans ça, le pas franchi n'a plus de numéro à
                            annoncer : l'icône est décorative et le libellé seul
                            ne dit pas le rang. */}
                        <span className="sr-only">Étape {index + 1}</span>
                      </>
                    ) : (
                      index + 1
                    )}
                  </span>
                  {ETIQUETTES[etape]}
                  {franchie ? (
                    <span className="sr-only">, terminée</span>
                  ) : null}
                </li>
              );
            })}
          </ol>

          {/* Repli mobile de `c2:138-141`. Il porte la même information que la
              liste ci-dessus, qui est retirée de l'arbre d'accessibilité par
              `hidden` : les deux ne coexistent jamais. */}
          <p className="flex items-baseline gap-2 lg:hidden">
            <span className="font-heading text-xl font-bold tracking-[-0.01em] text-primary">
              {ETIQUETTES[courante]}
            </span>
            <span className="text-sm text-muted-foreground">
              (étape {rang + 1} sur {ETAPES.length})
            </span>
          </p>
        </nav>
      </div>
    </header>
  );
}
