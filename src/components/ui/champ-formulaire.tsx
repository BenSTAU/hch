import type { ComponentProps, ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/// Triplet label plus contrôle plus message d'erreur, câblé une seule fois.
///
/// La pièce « champs » du patron d'administration, que la DoD 8 de T-B1-01
/// nomme à côté du tableau et de l'aide à l'audit. Sans elle, chaque écran
/// recopie `aria-invalid` et `aria-describedby` autour de chaque champ : la
/// première fiche du catalogue le faisait quatre fois, et onze écrans en
/// hériteraient. Chaque copie est une occasion de perdre un attribut.
///
/// Aucune connaissance du domaine, aucune route, aucun type de base : le test
/// mental de `04-folder-structure` §8.1 passe, d'où `components/ui/`.
///
/// Le câblage est appliqué **après** les props de l'appelant, donc il gagne :
/// un écran ne peut pas le défaire par inadvertance. `id`, `aria-invalid` et
/// `aria-describedby` sont retirés de la surface pour que la tentative échoue
/// à la compilation plutôt qu'en silence.
type ChampCommun = {
  id: string;
  libelle: string;
  /// Les messages de validation du champ, vides quand il n'y en a pas. La
  /// liste, et non une chaîne : Zod rend un tableau par champ.
  erreurs: readonly string[];
  /// Posée sur le conteneur, pas sur le contrôle - c'est la largeur du bloc
  /// que les mises en page en colonnes ont besoin de régler.
  className?: string;
};

type PropsControle = "id" | "aria-invalid" | "aria-describedby";

function idErreur(id: string): string {
  return `${id}-erreur`;
}

function cablage(id: string, erreurs: readonly string[]) {
  return {
    id,
    // `undefined` et non `false` : l'attribut doit disparaître du DOM quand le
    // champ est sain, `aria-invalid="false"` étant une affirmation de plus à
    // relire pour les lecteurs d'écran.
    "aria-invalid": erreurs.length > 0 || undefined,
    "aria-describedby": idErreur(id),
  } as const;
}

function Enveloppe({
  id,
  libelle,
  erreurs,
  className,
  children,
}: ChampCommun & { children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id}>{libelle}</Label>
      {children}
      {/* L'emplacement reste DANS LE FLUX même vide : une zone de message
          révélée en même temps que son contenu n'est pas annoncée de façon
          fiable par tous les couples lecteur/navigateur. */}
      <p id={idErreur(id)} className="text-sm text-destructive">
        {erreurs.join(" ")}
      </p>
    </div>
  );
}

export function ChampTexte({
  id,
  libelle,
  erreurs,
  className,
  ...controle
}: ChampCommun & Omit<ComponentProps<typeof Input>, PropsControle>) {
  return (
    <Enveloppe
      id={id}
      libelle={libelle}
      erreurs={erreurs}
      className={className}
    >
      <Input {...controle} {...cablage(id, erreurs)} />
    </Enveloppe>
  );
}

export function ChampZoneTexte({
  id,
  libelle,
  erreurs,
  className,
  ...controle
}: ChampCommun & Omit<ComponentProps<typeof Textarea>, PropsControle>) {
  return (
    <Enveloppe
      id={id}
      libelle={libelle}
      erreurs={erreurs}
      className={className}
    >
      <Textarea {...controle} {...cablage(id, erreurs)} />
    </Enveloppe>
  );
}
