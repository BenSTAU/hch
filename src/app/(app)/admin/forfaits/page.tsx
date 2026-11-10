import type { Metadata } from "next";
import { Plus } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EtatVide } from "@/components/ui/etat-vide";
import { Pagination } from "@/components/ui/pagination";
import { requireAdmin } from "@/lib/auth/permissions";
import {
  listForfaitsAdmin,
  lireForfaitAdmin,
  lireSyntheseForfaits,
} from "@/lib/db/queries/forfaits";
import {
  CHEMIN_ADMIN_FORFAITS,
  CHEMIN_ADMIN_FORFAIT_NOUVEAU,
  PARAM_PAGE,
  PARAM_SENS,
  PARAM_TRI,
} from "@/lib/routes";
import { lireTriForfaits } from "@/lib/validations/forfaits";

import { MessageFlash } from "./_components/message-flash";
import { SyntheseForfaits } from "./_components/synthese-forfaits";
import { TableForfaits } from "./_components/table-forfaits";

export const metadata: Metadata = {
  title: "Catalogue de forfaits - HomeCycl'Home",
};

/// Le message qui suit une action ayant redirigé.
///
/// L'URL porte un **identifiant**, jamais un libellé : le nom est relu en base
/// ici. Sinon `?ajoute=Vidange%20moteur` afficherait la confirmation d'un
/// forfait qui n'a jamais existé.
async function messageConfirmation(parametres: {
  ajoute?: string;
  modifie?: string;
  inchange?: string;
}): Promise<string> {
  if (parametres.inchange) return "Aucune modification";

  const ajout = parametres.ajoute !== undefined;
  const identifiant = Number(parametres.ajoute ?? parametres.modifie);
  if (!Number.isInteger(identifiant) || identifiant <= 0) return "";

  const forfait = await lireForfaitAdmin(identifiant);
  if (!forfait) return "";

  return `Forfait ${forfait.label} ${ajout ? "ajouté" : "modifié"}`;
}

/// Catalogue des forfaits - `US-FORFAIT-LISTER`, écran **A3**.
///
/// `requireAdmin()` est rejoué ici **et** dans chaque action : la page qui
/// protège ne protège pas l'action, et `src/proxy.ts` ne protège ni l'une ni
/// l'autre, il ne fait que rediriger sur l'absence de cookie.
///
/// Le message de succès arrive par l'URL : il est émis par une action qui a
/// redirigé, donc par un composant déjà démonté.
export default async function AdminForfaitsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    tri?: string;
    sens?: string;
    ajoute?: string;
    modifie?: string;
    inchange?: string;
  }>;
}) {
  const [, parametres] = await Promise.all([requireAdmin(), searchParams]);
  const { tri, sens, page } = lireTriForfaits(parametres);

  const [catalogue, synthese] = await Promise.all([
    listForfaitsAdmin({ page, tri, sens }),
    lireSyntheseForfaits(),
  ]);

  const message = await messageConfirmation(parametres);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-3xl font-bold">
            Catalogue de forfaits
          </h1>
          <p className="text-sm text-muted-foreground">
            La durée dimensionne le créneau réservable par le client.
          </p>
        </div>

        <Button asChild>
          <Link href={CHEMIN_ADMIN_FORFAIT_NOUVEAU}>
            <Plus aria-hidden="true" className="size-4" />
            Nouveau forfait
          </Link>
        </Button>
      </div>

      <MessageFlash message={message} />

      <SyntheseForfaits synthese={synthese} />

      {catalogue.total === 0 ? (
        <EtatVide
          titre="Aucun forfait au catalogue"
          description="Tant que le catalogue est vide, aucun client ne peut réserver."
        >
          <Button asChild>
            <Link href={CHEMIN_ADMIN_FORFAIT_NOUVEAU}>
              Ajouter un premier forfait
            </Link>
          </Button>
        </EtatVide>
      ) : (
        <TableForfaits forfaits={catalogue.forfaits} tri={tri} sens={sens} />
      )}

      <Pagination
        libelle="Pagination du catalogue"
        page={catalogue.page}
        pages={catalogue.pages}
        base={CHEMIN_ADMIN_FORFAITS}
        cleParametrePage={PARAM_PAGE}
        parametres={{ [PARAM_TRI]: tri, [PARAM_SENS]: sens }}
      />
    </>
  );
}
