"use client";

import { useAction } from "next-safe-action/hooks";

import { updateSettings } from "@/lib/actions/parametres/update-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/// Une ligne d'`app_settings` telle qu'elle traverse la frontière serveur →
/// client. `updatedAt` est déjà sérialisée par la page : la date n'est
/// affichée que comme information, et la reformater ici demanderait un fuseau
/// que le rendu serveur et le navigateur ne partagent pas forcément.
export type SettingField = {
  key: string;
  value: string | null;
  valueType: string;
  description: string | null;
  updatedAt: string;
};

/// Formulaire **générique** : un champ par ligne d'`app_settings`, pas cinq
/// champs codés en dur. C'est la raison d'être du modèle clé-valeur telle que
/// le dictionnaire la formule — *« ajouter un nouveau champ société ne
/// requiert pas de migration SQL »*. Coder les champs annulerait la propriété
/// qu'on a payée en choisissant ce modèle.
export function SettingsForm({ settings }: { settings: SettingField[] }) {
  const { execute, result, isPending } = useAction(updateSettings);

  const errorMessage = result.data?.error ?? result.serverError;

  const changed = result.data?.changedKeys;
  const statusMessage =
    changed === undefined
      ? ""
      : changed.length > 0
        ? `Modifications enregistrées (${changed.length}).`
        : // Sans cette branche, une soumission sans modification afficherait
          // « enregistré » alors qu'aucune écriture n'a eu lieu — le message
          // mentirait sur l'état de la base.
          "Aucune modification à enregistrer.";

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        execute({
          settings: settings.map((setting) => ({
            key: setting.key,
            value: String(data.get(setting.key) ?? ""),
          })),
        });
      }}
    >
      {/* Deux régions distinctes : `alert` interrompt, `status` attend une
          pause. Un refus et une confirmation n'ont pas la même urgence pour un
          lecteur d'écran (RGAA 12.x). */}
      <p role="alert" className="text-sm text-destructive empty:hidden">
        {errorMessage}
      </p>
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {statusMessage}
      </p>

      {settings.map((setting) => (
        <div key={setting.key} className="flex flex-col gap-2">
          {/* La clé sert de label quand `description` est NULL : elle est
              laide, mais un champ sans label est inutilisable au lecteur
              d'écran (RGAA 11.1). */}
          <Label htmlFor={setting.key}>
            {setting.description ?? setting.key}
          </Label>
          <Input
            id={setting.key}
            name={setting.key}
            defaultValue={setting.value ?? ""}
            // La clé est la seule chose que le serveur accepte, et elle vient
            // du rendu serveur. Elle est visible, jamais éditable.
            aria-describedby={`${setting.key}-cle`}
          />
          <span
            id={`${setting.key}-cle`}
            className="text-xs text-muted-foreground"
          >
            {setting.key}
          </span>
        </div>
      ))}

      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "Enregistrement…" : "Enregistrer"}
      </Button>
    </form>
  );
}
