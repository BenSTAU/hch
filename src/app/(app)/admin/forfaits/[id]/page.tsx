import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth/permissions";
import { lireForfaitAdmin } from "@/lib/db/queries/forfaits";

import { FormulaireForfait } from "../_components/formulaire-forfait";

export const metadata: Metadata = {
  title: "Modifier un forfait - HomeCycl'Home",
};

/// Fiche d'un forfait - `US-FORFAIT-MODIFIER`, désactivation et réactivation
/// comprises. Aucune maquette ne couvre cet écran : il reprend le formulaire
/// d'ajout, peuplé.
///
/// La fiche rendue ici porte le jeton de version que l'enregistrement devra
/// présenter. Recharger la page, c'est en obtenir un neuf.
export default async function FicheForfaitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [, { id }] = await Promise.all([requireAdmin(), params]);

  const identifiant = Number(id);
  // `Number("12abc")` vaut `NaN`, mais `Number("12.5")` vaut 12.5 : sans le
  // contrôle d'entier, une URL décimale atteindrait Prisma.
  if (!Number.isInteger(identifiant) || identifiant <= 0) notFound();

  const forfait = await lireForfaitAdmin(identifiant);
  if (!forfait) notFound();

  return (
    <>
      <h1 className="font-heading text-3xl font-bold">{forfait.label}</h1>
      <FormulaireForfait forfait={forfait} />
    </>
  );
}
