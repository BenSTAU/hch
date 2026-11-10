"use server";

import { redirect } from "next/navigation";

import { creerForfait } from "@/lib/db/queries/forfaits";
import { CHEMIN_ADMIN_FORFAITS } from "@/lib/routes";
import { adminActionClient } from "@/lib/safe-action";
import { ajouterForfaitSchema } from "@/lib/validations/forfaits";

import { messageRefusCreation } from "./messages";
import { revalidationCatalogue } from "./revalidation";

/// Ajout d'un forfait au catalogue - `US-FORFAIT-AJOUTER`.
///
/// ⚠️ La SPEC §Cas d'erreur décrit un `POST /admin/services` répondant 403 :
/// cet endpoint REST n'existe pas, c'est une Server Action. L'appelant sans
/// `ROLE_ADMIN` est arrêté par le middleware d'`adminActionClient`, **avant**
/// la validation Zod.
export const ajouterForfait = adminActionClient
  .inputSchema(ajouterForfaitSchema)
  .action(async ({ parsedInput, ctx: { admin } }) => {
    // L'acteur vient du CONTEXTE, jamais de la charge utile.
    const resultat = await creerForfait(parsedInput, admin.id);

    if (!resultat.ok) {
      // Pas de revalidation : rien n'a été écrit.
      return { error: messageRefusCreation(resultat) };
    }

    revalidationCatalogue();

    // L'IDENTIFIANT voyage dans l'URL, pas le libellé : la liste relit le nom
    // en base pour composer son message. Un libellé transporté en clair
    // permettrait de forger « Forfait X ajouté » pour un forfait qui n'a
    // jamais existé. Relevé par l'agent testeur (B2).
    redirect(`${CHEMIN_ADMIN_FORFAITS}?ajoute=${String(resultat.id)}`);
  });
