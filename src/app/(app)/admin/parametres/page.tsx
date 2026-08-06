import type { Metadata } from "next";

import { requireAdmin } from "@/lib/auth/permissions";
import { listAppSettings } from "@/lib/db/queries/parametres";

import { SettingsForm } from "./_components/settings-form";

export const metadata: Metadata = {
  title: "Paramètres société — HomeCycl'Home",
};

/// Première entité du modèle exercée de bout en bout (PLAN S1 §5.1).
///
/// Lecture directe en Server Component : `await` Prisma ici, mutation par
/// Server Action. Pas de Route Handler, pas de TanStack Query — cet écran
/// n'est aucune des trois vues qui y ont droit (PLAN S1 §6.1).
///
/// `requireAdmin()` est rejoué ici **et** dans l'action. La page qui protège
/// ne protège pas l'action, et `src/proxy.ts` ne protège ni l'une ni l'autre :
/// il ne fait que rediriger sur l'absence de cookie.
export default async function ParametresPage() {
  await requireAdmin();

  const settings = await listAppSettings();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-bold">Paramètres société</h1>
        <p className="text-sm text-muted-foreground">
          Ces informations alimentent la façade publique, les factures et les
          mentions légales.
        </p>
      </div>

      <SettingsForm
        settings={settings.map((setting) => ({
          key: setting.key,
          value: setting.value,
          valueType: setting.valueType,
          description: setting.description,
          updatedAt: setting.updatedAt.toISOString(),
        }))}
      />
    </main>
  );
}
