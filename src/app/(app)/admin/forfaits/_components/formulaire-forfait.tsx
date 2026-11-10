"use client";

import { useAction } from "next-safe-action/hooks";
import Link from "next/link";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ajouterForfait } from "@/lib/actions/forfaits/ajouter-forfait";
import { modifierForfaitAction } from "@/lib/actions/forfaits/modifier-forfait";
import type { ForfaitAdmin } from "@/lib/db/queries/forfaits";
import { CHEMIN_ADMIN_FORFAITS } from "@/lib/routes";

/// Formulaire de forfait, **un seul pour l'ajout et la modification** : les
/// deux US partagent leurs règles de validation et leurs messages, deux
/// formulaires divergeraient au premier champ ajouté.
///
/// Une page et non un panneau latéral, contre la maquette A3 : un panneau ne
/// survit pas à un rechargement, et le refus de concurrence demande
/// littéralement de recharger la fiche.
export function FormulaireForfait({ forfait }: { forfait?: ForfaitAdmin }) {
  const alertRef = useRef<HTMLParagraphElement>(null);
  const ajout = useAction(ajouterForfait);
  const modification = useAction(modifierForfaitAction);

  const courant = forfait ? modification : ajout;
  const { result, isPending } = courant;

  const erreursChamp = (champ: string): string[] => {
    const erreurs = result.validationErrors as
      Record<string, { _errors?: string[] } | undefined> | undefined;
    return erreurs?.[champ]?._errors ?? [];
  };

  const messageErreur =
    result.data?.error ??
    result.serverError ??
    (result.validationErrors
      ? "Vérifiez les champs du formulaire."
      : undefined);

  useEffect(() => {
    if (messageErreur) alertRef.current?.focus();
  }, [messageErreur]);

  return (
    <form
      className="flex max-w-xl flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const champs = {
          label: String(data.get("label") ?? ""),
          description: String(data.get("description") ?? ""),
          duration: String(data.get("duration") ?? ""),
          price: String(data.get("price") ?? ""),
          isActive: data.get("isActive") === "on",
        };

        if (forfait) {
          modification.execute({
            ...champs,
            id: forfait.id,
            version: forfait.version,
          });
          return;
        }

        ajout.execute(champs);
      }}
    >
      {/* Dans le flux même vide : une région live révélée en même temps que
          son contenu n'est pas annoncée de façon fiable. */}
      <p
        ref={alertRef}
        role="alert"
        tabIndex={-1}
        className="text-sm text-destructive"
      >
        {messageErreur}
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="label">Nom du forfait</Label>
        <Input
          id="label"
          name="label"
          defaultValue={forfait?.label ?? ""}
          required
          aria-invalid={erreursChamp("label").length > 0 || undefined}
          aria-describedby="label-erreur"
        />
        <p id="label-erreur" className="text-sm text-destructive">
          {erreursChamp("label").join(" ")}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          rows={4}
          defaultValue={forfait?.description ?? ""}
          aria-invalid={erreursChamp("description").length > 0 || undefined}
          aria-describedby="description-erreur"
        />
        {/* Un emplacement d'erreur comme les trois autres champs : sans lui, un
            refus Zod sur la description ne produirait que le message générique,
            sans dire lequel (RGAA 11.10). */}
        <p id="description-erreur" className="text-sm text-destructive">
          {erreursChamp("description").join(" ")}
        </p>
      </div>

      <div className="flex gap-4">
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="price">Prix TTC (€)</Label>
          <Input
            id="price"
            name="price"
            inputMode="decimal"
            defaultValue={forfait?.price ?? ""}
            required
            aria-invalid={erreursChamp("price").length > 0 || undefined}
            aria-describedby="price-erreur"
          />
          <p id="price-erreur" className="text-sm text-destructive">
            {erreursChamp("price").join(" ")}
          </p>
        </div>

        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="duration">Durée (min)</Label>
          <Input
            id="duration"
            name="duration"
            inputMode="numeric"
            defaultValue={forfait ? String(forfait.duration) : ""}
            required
            aria-invalid={erreursChamp("duration").length > 0 || undefined}
            aria-describedby="duration-erreur"
          />
          <p id="duration-erreur" className="text-sm text-destructive">
            {erreursChamp("duration").join(" ")}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <input
          id="isActive"
          name="isActive"
          type="checkbox"
          // Un forfait naît disponible à la réservation (`is_active` vaut
          // `true` par défaut au modèle).
          defaultChecked={forfait?.isActive ?? true}
          className="size-4 accent-primary"
        />
        <Label htmlFor="isActive">Proposé à la réservation</Label>
      </div>

      {forfait ? (
        <>
          {/* Le jeton de la version ouverte. Opaque, et sans pouvoir : il
              désigne une version, il n'autorise rien. */}
          <input type="hidden" name="version" value={forfait.version} />
          <p className="text-sm text-muted-foreground">
            Les rendez-vous déjà pris gardent leur prix et leur durée.
          </p>
        </>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending
            ? "Enregistrement…"
            : forfait
              ? "Enregistrer"
              : "Ajouter au catalogue"}
        </Button>
        <Button asChild variant="ghost">
          <Link href={CHEMIN_ADMIN_FORFAITS}>Annuler</Link>
        </Button>
      </div>
    </form>
  );
}
