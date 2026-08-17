"use client";

import { UploadCloud } from "lucide-react";
import Image from "next/image";
import { useId, useRef, useState, useTransition } from "react";

import { ajouterPhoto } from "@/lib/actions/interventions/ajouter-photo";
import { FORMATS_ACCEPTES, MAX_PHOTOS } from "@/lib/photos/quotas";
import { cn } from "@/lib/utils";

/// Bloc « Photos » du panneau de détail — dépôt **T+n**.
///
/// `US-INTERVENTION-PHOTOS-AJOUTER` couvre deux moments : le tunnel (T=0), livré
/// par T-V3-08, et l'intervention déjà planifiée (T+n), qui est ici. La
/// différence n'est pas cosmétique : au T=0 l'intervention n'existe pas encore
/// et les lignes `photos` naissent dans la transaction de validation ; au T+n
/// elle préexiste, donc **l'écriture est immédiate**.
///
/// `uploads/` vit hors de `public/`, rien n'y est servi statiquement. Chaque
/// vignette interroge `GET /api/intervention-photos/[id]`, qui vérifie en base
/// que la photo est sur une intervention de ce client. Arbitré le 2026-08-11 :
/// une photo prise au domicile de quelqu'un ne doit pas dépendre du seul
/// caractère non devinable de son URL.
///
/// ⚠️ **Aucune US ne décrit le retrait d'une photo après validation.** Le bouton
/// « supprimer » que la SPEC mentionne porte sur les vignettes du tunnel, *avant*
/// validation finale de la réservation. Le manque est signalé en PR, il n'est
/// pas comblé ici.

export function BlocPhotos({
  interventionId,
  photos,
  modifiable,
}: {
  interventionId: number;
  photos: readonly { id: number }[];
  modifiable: boolean;
}) {
  const [enCours, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const champRef = useRef<HTMLInputElement>(null);
  const idChamp = useId();

  const complet = photos.length >= MAX_PHOTOS;

  function deposer(fichiers: FileList | null) {
    if (!fichiers || fichiers.length === 0) return;
    setErreur(null);

    // Le quota côté écran ne fait qu'éviter des allers-retours perdus : celui
    // qui décide est compté **sous verrou**, dans la transaction
    // d'`attacherPhoto`. Sans ce verrou, deux onglets ouverts le
    // franchiraient tous les deux.
    const place = MAX_PHOTOS - photos.length;
    if (place <= 0) {
      setErreur(`${String(MAX_PHOTOS)} photos maximum par intervention.`);
      return;
    }

    demarrer(async () => {
      // Séquentiel et non en parallèle : le quota de l'endpoint d'upload compte
      // les requêtes, et cinq envois simultanés le videraient d'un coup sans
      // que le client comprenne pourquoi la cinquième échoue.
      for (const fichier of Array.from(fichiers).slice(0, place)) {
        const corps = new FormData();
        corps.append("photo", fichier);

        // Deux temps, un seul chemin de traitement d'image : l'endpoint décode,
        // dépouille l'EXIF et ré-encode en WebP ; l'action écrit la ligne.
        const reponse = await fetch("/api/upload-intervention-photo", {
          method: "POST",
          body: corps,
        });

        const donnees = (await reponse.json()) as {
          ok?: boolean;
          url?: string;
          message?: string;
        };

        if (!reponse.ok || !donnees.ok || !donnees.url) {
          setErreur(donnees.message ?? "L'envoi a échoué, réessayez.");
          break;
        }

        const resultat = await ajouterPhoto({
          interventionId,
          url: donnees.url,
        });

        if (resultat?.data?.message) {
          setErreur(resultat.data.message);
          break;
        }
      }

      // Sans ça, redéposer le même fichier ne déclencherait aucun `change` - la
      // valeur de l'input n'aurait pas varié.
      if (champRef.current) champRef.current.value = "";
    });
  }

  return (
    <section aria-labelledby="bloc-photos" className="flex flex-col gap-3">
      <h3 id="bloc-photos" className="text-base font-semibold">
        Photos préparatoires
      </h3>

      {photos.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucune photo jointe à cette intervention.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {photos.map((photo, index) => (
            <li key={photo.id}>
              {/* `unoptimized` : l'optimiseur d'images de Next refetch l'URL
                  **depuis le serveur**, sans le cookie de session, et se
                  heurterait au 404 de la route contrôlée. La photo est déjà
                  ré-encodée en WebP à l'upload, il n'y a rien à optimiser. */}
              <Image
                src={`/api/intervention-photos/${String(photo.id)}`}
                alt={`Photo ${String(index + 1)} de l'intervention`}
                width={96}
                height={96}
                unoptimized
                className="size-24 rounded-xl border border-border object-cover"
              />
            </li>
          ))}
        </ul>
      )}

      {modifiable ? (
        <>
          <label
            htmlFor={idChamp}
            className={cn(
              "flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-input bg-secondary/50 p-6 text-center transition-colors",
              "has-[:focus-visible]:border-primary has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
              complet || enCours
                ? "cursor-not-allowed opacity-60"
                : "cursor-pointer hover:border-primary/50",
            )}
          >
            <UploadCloud aria-hidden="true" className="size-6 text-primary" />
            <span className="text-sm font-semibold">
              Ajouter une photo pour le technicien
            </span>
            <span className="text-xs text-muted-foreground">
              JPG, PNG, WEBP ou HEIC, 5 Mo maximum, {MAX_PHOTOS} photos au plus.
            </span>

            <input
              ref={champRef}
              id={idChamp}
              type="file"
              accept={FORMATS_ACCEPTES}
              multiple
              className="sr-only"
              disabled={enCours || complet}
              onChange={(evenement) => {
                deposer(evenement.target.files);
              }}
            />
          </label>

          <p role="status" aria-live="polite" className="text-sm empty:hidden">
            {enCours ? "Envoi en cours…" : ""}
          </p>
        </>
      ) : null}

      {erreur ? (
        <p role="alert" className="text-sm text-destructive">
          {erreur}
        </p>
      ) : null}
    </section>
  );
}
