import { revalidatePath } from "next/cache";

/// ⚠️ **Hors des fichiers `"use server"`**, qui n'exportent que des fonctions
/// asynchrones : y poser ce helper synchrone casserait la compilation.

/// Invalidation **large, et assumée** : le catalogue est lu par deux layouts et
/// trois pages (`(app)/layout.tsx`, `(marketing)/layout.tsx`,
/// `(marketing)/page.tsx`, `(tunnel)/reserver/page.tsx`). Énumérer ces chemins
/// produirait une liste que la prochaine surface publique oublierait de
/// compléter, et un forfait désactivé resterait visible pour un client.
///
/// Le coût est réel, elle emporte la vitrine entière. Accepté parce que
/// l'administration du catalogue est rare, là où la lecture est permanente.
export function revalidationCatalogue(): void {
  revalidatePath("/", "layout");
}
