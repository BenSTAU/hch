import type { Metadata } from "next";

import { requireAdmin } from "@/lib/auth/permissions";

import { FormulaireForfait } from "../_components/formulaire-forfait";

export const metadata: Metadata = {
  title: "Nouveau forfait - HomeCycl'Home",
};

/// Ajout d'un forfait - `US-FORFAIT-AJOUTER`, écran **A3**.
export default async function NouveauForfaitPage() {
  await requireAdmin();

  return (
    <>
      <h1 className="font-heading text-3xl font-bold">Nouveau forfait</h1>
      <FormulaireForfait />
    </>
  );
}
