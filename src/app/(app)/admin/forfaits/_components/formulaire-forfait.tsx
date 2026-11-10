"use client";

import { useAction } from "next-safe-action/hooks";
import Link from "next/link";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { ChampTexte, ChampZoneTexte } from "@/components/ui/champ-formulaire";
import { Label } from "@/components/ui/label";
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
        };

        if (forfait) {
          modification.execute({
            ...champs,
            // La disponibilité n'est saisie qu'en modification : à la création,
            // `US-FORFAIT-AJOUTER` la pose en défaut et ne l'énumère pas.
            isActive: data.get("isActive") === "on",
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

      <ChampTexte
        id="label"
        libelle="Nom du forfait"
        name="label"
        defaultValue={forfait?.label ?? ""}
        required
        erreurs={erreursChamp("label")}
      />

      <ChampZoneTexte
        id="description"
        libelle="Description"
        name="description"
        rows={4}
        defaultValue={forfait?.description ?? ""}
        erreurs={erreursChamp("description")}
      />

      <div className="flex gap-4">
        <ChampTexte
          id="price"
          libelle="Prix TTC (€)"
          name="price"
          inputMode="decimal"
          defaultValue={forfait?.price ?? ""}
          required
          erreurs={erreursChamp("price")}
          className="flex-1"
        />

        <ChampTexte
          id="duration"
          libelle="Durée (min)"
          name="duration"
          inputMode="numeric"
          defaultValue={forfait ? String(forfait.duration) : ""}
          required
          erreurs={erreursChamp("duration")}
          className="flex-1"
        />
      </div>

      {forfait ? (
        <>
          {/* ⚠️ **Absente du formulaire de création**, et c'est la SPEC :
              `US-FORFAIT-AJOUTER` n'énumère pas ce champ et pose `is_active`
              en défaut. L'offrir permettrait de créer un forfait déjà
              désactivé, état que rien ne spécifie - et la désactivation est
              une action sur une fiche qui existe. */}
          <div className="flex items-center gap-3">
            <input
              id="isActive"
              name="isActive"
              type="checkbox"
              defaultChecked={forfait.isActive}
              className="size-4 accent-primary"
            />
            <Label htmlFor="isActive">Proposé à la réservation</Label>
          </div>

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
