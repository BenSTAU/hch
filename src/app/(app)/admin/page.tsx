import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth/permissions";
import { CHEMIN_ADMIN_FORFAITS } from "@/lib/routes";

/// `/admin` ne porte aucun écran : le tableau de bord d'administration
/// (maquette A1) est du bloc 2. Une page vide en attendant se ferait prendre
/// pour l'écran manquant.
///
/// La garde passe **avant** la redirection : sans elle, un visiteur sans rôle
/// serait renvoyé vers `/admin/forfaits` pour n'y recevoir son 403 qu'ensuite.
export default async function AdminPage() {
  await requireAdmin();

  redirect(CHEMIN_ADMIN_FORFAITS);
}
