"use client";

import { parseAsString, useQueryStates } from "nuqs";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/// Filtre par période de l'historique — **C10**.
///
/// `US-INTERVENTIONS-LISTER-CLIENT-PASSEES` : « un filtre par période (année, ou
/// date début / fin) est disponible ». La forme retenue est le couple de dates,
/// celle que dessine la maquette.
///
/// ── Ce qui n'est pas porté
///
/// Les sélecteurs « Tous les statuts » et « Tous les techniciens » de C10 :
/// aucun critère d'acceptation ne les demande, et le premier n'aurait que deux
/// valeurs (`DONE`, `CANCELLED`) que l'étiquette de chaque ligne porte déjà.
///
/// ── `shallow: false`, et c'est le point
///
/// Le filtrage se fait **en base**, dans un Server Component. Sans ce drapeau,
/// `nuqs` met l'URL à jour sans repasser par le serveur : l'adresse changerait
/// et la liste non. Il remet aussi `page` à zéro, faute de quoi un filtre
/// resserré depuis la page 3 afficherait une page vide.
export function FiltrePeriode() {
  const [periode, setPeriode] = useQueryStates(
    {
      du: parseAsString.withDefault(""),
      au: parseAsString.withDefault(""),
      page: parseAsString.withDefault(""),
    },
    { shallow: false },
  );

  const actif = periode.du !== "" || periode.au !== "";

  return (
    // Pas de `<form>` : chaque champ écrit directement dans l'URL, il n'y a rien
    // à soumettre. Un formulaire ajouterait un bouton « Filtrer » que la
    // maquette n'a pas et qu'aucun critère ne demande.
    <div className="flex flex-wrap items-end gap-4 rounded-xl bg-secondary/60 px-4 py-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="periode-du" className="text-sm text-muted-foreground">
          Du
        </Label>
        <Input
          id="periode-du"
          type="date"
          value={periode.du}
          className="w-auto bg-background"
          onChange={(evenement) => {
            void setPeriode({ du: evenement.target.value, page: "" });
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="periode-au" className="text-sm text-muted-foreground">
          Au
        </Label>
        <Input
          id="periode-au"
          type="date"
          value={periode.au}
          className="w-auto bg-background"
          onChange={(evenement) => {
            void setPeriode({ au: evenement.target.value, page: "" });
          }}
        />
      </div>

      {/* Rendu seulement quand il a quelque chose à réinitialiser : un bouton
          désactivé en permanence est du bruit dans la navigation clavier. */}
      {actif ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            void setPeriode({ du: "", au: "", page: "" });
          }}
        >
          Réinitialiser
        </Button>
      ) : null}
    </div>
  );
}
