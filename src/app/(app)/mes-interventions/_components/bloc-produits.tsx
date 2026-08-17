"use client";

import { Package, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";

import { ajouterProduit } from "@/lib/actions/produits/ajouter-produit";
import { retirerProduit } from "@/lib/actions/produits/retirer-produit";
import type { ProduitAttache } from "@/lib/db/queries/interventions";
import type { ProduitVendable } from "@/lib/db/queries/produits";
import { formatPrixEuros, multiplierEuros } from "@/lib/format";
import { Button } from "@/components/ui/button";

/// Bloc « Produits additionnels » du panneau de détail — **montage T+n**.
///
/// ⚠️ **Cette tâche ne livre que le montage.** La logique, les deux Server
/// Actions, le verrou de stock pessimiste et leurs tests appartiennent à
/// T-V3-09 ([PR #32]) ; le montage lui a été transféré par l'arbitrage du
/// 2026-08-10, T-V3-09 passant avant le propriétaire de l'écran. Le
/// `revalidatePath` que les deux actions avaient laissé en report est posé au
/// même geste. Même mécanique que le bloc adresses de [PR #23], monté par
/// T-V3-07.
///
/// CLAUDE.md §State propose `useOptimistic` pour les mutations à retour
/// immédiat. Il ne convient pas ici : le stock se vérifie **sous verrou** au
/// moment d'écrire, et un refus (« Stock insuffisant, quantité maximale : 2 »)
/// est un cas nominal, pas une panne. Afficher la ligne avant la réponse
/// obligerait à la retirer sous les yeux du client une fois sur dix.
///
/// `US-INTERVENTION-PRODUIT-SUPPRIMER` décrit un bouton « Retirer » sur la
/// ligne, pas un décrément unité par unité, et la restitution de stock suit la
/// quantité retirée. Le sélecteur en pilule du tunnel (T=0) n'a donc pas
/// d'équivalent ici : ce sont deux gestes différents, pas deux rendus du même.
export function BlocProduits({
  interventionId,
  lignes,
  catalogue,
  modifiable,
}: {
  interventionId: number;
  lignes: readonly ProduitAttache[];
  catalogue: readonly ProduitVendable[];
  modifiable: boolean;
}) {
  const [enCours, demarrer] = useTransition();
  const [refus, setRefus] = useState<string | null>(null);
  const [catalogueOuvert, setCatalogueOuvert] = useState(false);

  // Un produit déjà attaché reste proposé : `quantity` est un DELTA, et le
  // client peut vouloir une seconde chambre à air. C'est l'`upsert` de
  // `ajouterProduitIntervention` qui incrémente la ligne existante.
  const proposables = catalogue.filter((produit) => produit.stock > 0);

  function agir(action: () => Promise<{ message?: string } | undefined>) {
    setRefus(null);
    demarrer(async () => {
      const resultat = await action();
      // `message` n'est présent que sur un refus métier. Une panne serveur
      // remonte par `serverError` et affiche le libellé générique du client
      // d'action.
      if (resultat?.message) setRefus(resultat.message);
    });
  }

  return (
    <section aria-labelledby="bloc-produits" className="flex flex-col gap-3">
      <h3 id="bloc-produits" className="text-base font-semibold">
        Produits additionnels
      </h3>

      {lignes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucun produit attaché à cette intervention.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lignes.map((ligne) => (
            <li
              key={ligne.productId}
              className="flex items-center justify-between gap-3 rounded-xl bg-secondary/60 px-4 py-3"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {ligne.label} x {ligne.quantity}
                </span>
                {/* Le prix figé à la vente, pas celui du catalogue : un
                    changement de tarif n'altère jamais une ligne déjà vendue
                    (Constitution §4.1). */}
                <span className="block text-sm text-muted-foreground">
                  {formatPrixEuros(
                    multiplierEuros(ligne.unitPriceSnapshot, ligne.quantity),
                  )}
                </span>
              </span>

              {modifiable ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Retirer ${ligne.label}`}
                  disabled={enCours}
                  onClick={() => {
                    agir(async () => {
                      const resultat = await retirerProduit({
                        interventionId,
                        productId: ligne.productId,
                      });
                      return resultat?.data;
                    });
                  }}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {modifiable ? (
        <>
          <Button
            type="button"
            variant="ghost"
            className="self-start"
            aria-expanded={catalogueOuvert}
            onClick={() => {
              setCatalogueOuvert((ouvert) => !ouvert);
            }}
          >
            <Plus aria-hidden="true" />
            Ajouter un produit
          </Button>

          {catalogueOuvert ? (
            proposables.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucun produit disponible à la vente pour le moment.
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {proposables.map((produit) => (
                  <li
                    key={produit.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      {/* Pas de vignette : `products` n'a aucune colonne
                          d'image, et les URL `lh3.googleusercontent.com` de la
                          maquette sont interdites par le bloc *Global* des
                          notes de portage. */}
                      <Package
                        aria-hidden="true"
                        className="size-5 shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {produit.label}
                        </span>
                        <span className="block text-sm text-muted-foreground">
                          {formatPrixEuros(produit.price)}
                        </span>
                      </span>
                    </span>

                    {/* `aria-label` et non un `<span class="sr-only">` accole :
                        JSX supprime le saut de ligne entre les deux, et le nom
                        accessible vaudrait « AjouterAntivol en U ». Un lecteur
                        d'ecran l'annonce tel quel. */}
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-label={`Ajouter ${produit.label}`}
                      disabled={enCours}
                      onClick={() => {
                        agir(async () => {
                          const resultat = await ajouterProduit({
                            interventionId,
                            productId: produit.id,
                            quantity: 1,
                          });
                          return resultat?.data;
                        });
                      }}
                    >
                      Ajouter
                    </Button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </>
      ) : null}

      {refus ? (
        <p role="alert" className="text-sm text-destructive">
          {refus}
        </p>
      ) : null}
    </section>
  );
}
