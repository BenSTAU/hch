"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";

/// Bloc « Photos préparatoires » de l'écran **C5**.
///
/// Les fichiers montent **immédiatement** vers
/// `POST /api/upload-intervention-photo`, qui les dépouille de leur EXIF et
/// rend un chemin. Les lignes `photos`, elles, ne naissent qu'à la validation :
/// `photos.intervention_id` est NOT NULL, l'ordre inverse est impossible.
///
/// Conséquence assumée : un tunnel abandonné laisse des fichiers sans ligne.
/// Ils ne sont référencés par rien et le quota de l'endpoint borne le disque.
///
/// La prévisualisation utilise l'objet local du navigateur, pas le fichier
/// stocké : `uploads/` n'est pas servi par Next, et afficher l'aperçu ne doit
/// pas dépendre d'une route qui n'existe pas.

const MAX_PHOTOS = 5;

const FORMATS = "image/jpeg,image/png,image/webp,image/heic,image/heif";

type PhotoDeposee = {
  /// Chemin rendu par le serveur — c'est lui qui part à la validation.
  url: string;
  /// URL d'objet local, pour l'aperçu. Révoquée au retrait.
  apercu: string;
  nom: string;
};

export function EtapePhotos({
  photos,
  onChangement,
}: {
  photos: readonly PhotoDeposee[];
  onChangement: (photos: PhotoDeposee[]) => void;
}) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const champRef = useRef<HTMLInputElement>(null);

  async function deposer(fichiers: FileList | null) {
    if (!fichiers || fichiers.length === 0) return;
    setErreur(null);

    const place = MAX_PHOTOS - photos.length;
    if (place <= 0) {
      setErreur(`${String(MAX_PHOTOS)} photos au maximum.`);
      return;
    }

    setEnCours(true);
    const ajoutees: PhotoDeposee[] = [];

    // Séquentiel et non en parallèle : le quota de l'endpoint compte les
    // requêtes, et cinq envois simultanés le videraient d'un coup sans que
    // l'utilisateur comprenne pourquoi la cinquième échoue.
    for (const fichier of Array.from(fichiers).slice(0, place)) {
      const corps = new FormData();
      corps.append("photo", fichier);

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
        setErreur(donnees.message ?? "L'envoi a échoué — réessayez.");
        break;
      }

      ajoutees.push({
        url: donnees.url,
        apercu: URL.createObjectURL(fichier),
        nom: fichier.name,
      });
    }

    setEnCours(false);
    if (ajoutees.length > 0) onChangement([...photos, ...ajoutees]);

    // Sans ça, redéposer le même fichier après un retrait ne déclencherait
    // aucun `change` — la valeur de l'input n'aurait pas varié.
    if (champRef.current) champRef.current.value = "";
  }

  function retirer(url: string) {
    const partante = photos.find((photo) => photo.url === url);
    if (partante) URL.revokeObjectURL(partante.apercu);
    onChangement(photos.filter((photo) => photo.url !== url));
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Photos préparatoires</h2>
        <p className="text-sm text-muted-foreground">
          Facultatif — jusqu&apos;à {MAX_PHOTOS} photos de 5 Mo. Elles aident le
          technicien à préparer son intervention.
        </p>
      </div>

      <input
        ref={champRef}
        id="photos-tunnel"
        type="file"
        accept={FORMATS}
        multiple
        className="text-sm"
        disabled={enCours || photos.length >= MAX_PHOTOS}
        onChange={(evenement) => {
          void deposer(evenement.target.files);
        }}
      />

      <p role="status" aria-live="polite" className="text-sm empty:hidden">
        {enCours ? "Envoi en cours…" : ""}
      </p>

      {erreur && (
        <p role="alert" className="text-sm text-destructive">
          {erreur}
        </p>
      )}

      {photos.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {photos.map((photo) => (
            <li key={photo.url} className="flex flex-col items-center gap-1">
              {/* `<img>` et non `next/image` : la source est un objet local
                  (`blob:`), que l'optimiseur de Next ne sait pas traiter et
                  n'aurait aucune raison de traiter — l'image ne quitte pas le
                  navigateur. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.apercu}
                alt={`Aperçu de ${photo.nom}`}
                width={96}
                height={96}
                className="h-24 w-24 rounded-xl object-cover"
              />
              <Button
                type="button"
                variant="ghost"
                className="h-auto p-1 text-xs"
                onClick={() => {
                  retirer(photo.url);
                }}
              >
                Retirer
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export type { PhotoDeposee };
