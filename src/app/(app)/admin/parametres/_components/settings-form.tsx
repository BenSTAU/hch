"use client";

import { useAction } from "next-safe-action/hooks";
import { useEffect, useRef } from "react";

import { updateSettings } from "@/lib/actions/parametres/update-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/// Une ligne d'`app_settings` telle qu'elle traverse la frontière serveur →
/// client. `updatedAt` arrive en ISO : la page ne peut pas la formater pour un
/// fuseau qu'elle ne connaît pas, et un formatage divergent entre serveur et
/// navigateur casserait l'hydratation.
export type SettingField = {
  key: string;
  value: string | null;
  valueType: string;
  description: string | null;
  updatedAt: string;
};

/// Formatage figé en UTC et en français : le rendu serveur et le rendu client
/// doivent produire exactement la même chaîne, sans quoi React signale une
/// divergence d'hydratation. La base est en UTC (PLAN S2 T5), l'afficher tel
/// quel est honnête.
const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "UTC",
});

/// Traduit le `value_type` en indices de saisie. Purement ergonomique — la
/// validation qui compte vit dans `validateSettingValue`, côté serveur, parce
/// qu'un attribut HTML se contourne.
function inputAttributes(valueType: string) {
  switch (valueType) {
    case "url":
      return { type: "url" as const };
    case "number":
      return { inputMode: "decimal" as const };
    default:
      return {};
  }
}

/// Formulaire **générique** : un champ par ligne d'`app_settings`, pas cinq
/// champs codés en dur. C'est la raison d'être du modèle clé-valeur telle que
/// le dictionnaire la formule — *« ajouter un nouveau champ société ne
/// requiert pas de migration SQL »*. Coder les champs annulerait la propriété
/// qu'on a payée en choisissant ce modèle.
export function SettingsForm({ settings }: { settings: SettingField[] }) {
  const alertRef = useRef<HTMLParagraphElement>(null);
  const { execute, result, isPending } = useAction(updateSettings);

  // `validationErrors` est un canal distinct de `data` et de `serverError`
  // (next-safe-action). Ne pas le lire laissait une soumission refusée par Zod
  // se solder par un clic sans effet — WCAG 3.3.1, niveau A. Relevé par
  // l'agent testeur sur T-J0-05 (B1).
  const errorMessage =
    result.data?.error ??
    result.serverError ??
    (result.validationErrors
      ? "Vérifiez les champs du formulaire."
      : undefined);

  const invalidKeys = new Set(result.data?.invalidKeys ?? []);

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

  // Le focus rejoint le message de refus, comme le fait déjà le formulaire de
  // connexion. Sans ça, un utilisateur au clavier soumet, ne voit rien bouger
  // sous son curseur, et doit remonter tout le formulaire pour trouver la
  // cause. Asymétrie relevée par l'agent testeur.
  useEffect(() => {
    if (errorMessage) alertRef.current?.focus();
  }, [errorMessage]);

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
          pause. Elles restent DANS LE FLUX même vides — une région live
          révélée en même temps que son contenu n'est pas annoncée de façon
          fiable par tous les couples lecteur/navigateur, et `empty:hidden`
          produisait exactement ce cas. Relevé par l'agent testeur. */}
      <p
        ref={alertRef}
        role="alert"
        tabIndex={-1}
        className="text-sm text-destructive"
      >
        {errorMessage}
      </p>
      <p role="status" className="text-sm text-muted-foreground">
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
            aria-invalid={invalidKeys.has(setting.key) || undefined}
            // La clé est la seule chose que le serveur accepte, et elle vient
            // du rendu serveur. Elle est visible, jamais éditable.
            aria-describedby={`${setting.key}-meta`}
            {...inputAttributes(setting.valueType)}
          />
          <span
            id={`${setting.key}-meta`}
            className="text-xs text-muted-foreground"
          >
            {setting.key} · modifié le{" "}
            <time dateTime={setting.updatedAt}>
              {DATE_FORMAT.format(new Date(setting.updatedAt))} UTC
            </time>
          </span>
        </div>
      ))}

      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "Enregistrement…" : "Enregistrer"}
      </Button>
    </form>
  );
}
