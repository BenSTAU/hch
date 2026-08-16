"use client";

import { useId, type ReactNode } from "react";

import type { CycleClient } from "@/lib/db/queries/cycles";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

import { BadgeTypeCycle } from "./badge-type-cycle";

/// La valeur du détachement. Une chaîne sentinelle et non `""` : Radix traite
/// la chaîne vide comme « aucune option retenue », et le bouton « Aucun vélo »
/// ne pourrait alors jamais s'afficher coché.
const AUCUN = "aucun";

/// Sélecteur « un vélo, ou aucun », partagé par les deux surfaces qui désignent
/// un cycle : le panneau de détail de `/mes-interventions` (rattachement T+n,
/// T-V3-16) et l'écran **C5** du tunnel (T=0).
///
/// Né dans `mes-interventions/_components/bloc-cycle.tsx`, monté ici au **2ᵉ
/// usage** - la règle des 2 usages est atteinte pile ici.
///
/// ⚠️ **Il porte le choix, jamais l'écriture.** Les deux appelants écrivent à
/// des moments différents : le panneau appelle `rattacherCycle` à chaque clic,
/// le tunnel garde la valeur jusqu'à la validation, où elle part dans la
/// transaction de réservation. Y loger une Server Action rendrait le second
/// impossible.
///
/// ⚠️ **L'état vide reste chez l'appelant**, et ce n'est pas un oubli : le
/// panneau propose d'aller créer un vélo, le tunnel ne le fait pas - un lien
/// vers `/mon-compte/cycles` ferait sortir du tunnel à l'avant-dernier geste.
export function SelecteurCycle({
  cycles,
  valeur,
  onChangement,
  disabled = false,
  idLibelle,
}: {
  cycles: readonly CycleClient[];
  /// `null` désigne « Aucun vélo ». La valeur vient toujours de l'appelant :
  /// du serveur pour le panneau, de l'état du tunnel pour C5.
  valeur: number | null;
  onChangement: (cycleId: number | null) => void;
  disabled?: boolean;
  /// Identifiant du titre visible, cible de l'`aria-labelledby` du groupe.
  idLibelle: string;
}) {
  // Les identifiants sont dérivés d'un `useId()` et non écrits en dur : deux
  // sélecteurs sur une même page se voleraient leurs `<label for>`.
  const base = useId();

  return (
    <RadioGroup
      aria-labelledby={idLibelle}
      value={valeur === null ? AUCUN : String(valeur)}
      onValueChange={(choix) => {
        onChangement(choix === AUCUN ? null : Number(choix));
      }}
      disabled={disabled}
      className="grid grid-cols-1 gap-2 sm:grid-cols-2"
    >
      <Option valeur={AUCUN} id={`${base}-aucun`}>
        <span className="text-sm font-medium">Aucun vélo</span>
      </Option>

      {cycles.map((candidat) => (
        <Option
          key={candidat.id}
          valeur={String(candidat.id)}
          id={`${base}-${String(candidat.id)}`}
        >
          <span className="min-w-0 text-sm font-medium">
            {candidat.brand}
            {candidat.model ? ` ${candidat.model}` : ""}
          </span>
          <BadgeTypeCycle type={candidat.type} />
        </Option>
      ))}
    </RadioGroup>
  );
}

function Option({
  valeur,
  id,
  children,
}: {
  valeur: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <Label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3 transition-colors",
        "hover:border-input",
        "has-[[aria-checked=true]]:border-primary has-[[aria-checked=true]]:bg-primary-fixed/20",
        "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
        "has-[:disabled]:opacity-60",
      )}
    >
      {/* Le bouton radio est masqué visuellement, la dalle entière lui sert
          d'étiquette. `aria-labelledby` pointe sur le libellé visible : Chrome
          ne calcule aucun nom accessible pour un `<button role="radio">`
          étiqueté par un `<label for>`, constaté au navigateur sur C2. */}
      <RadioGroupItem
        id={id}
        value={valeur}
        aria-labelledby={`${id}-libelle`}
        className="sr-only"
      />
      <span id={`${id}-libelle`} className="flex min-w-0 items-center gap-2">
        {children}
      </span>
    </Label>
  );
}
