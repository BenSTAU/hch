"use client";

import { ImageIcon, UploadCloud, X } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/// Bloc « Photos préparatoires » de l'écran **C5** (`c5:246-257`).
///
/// Les fichiers montent **immédiatement** vers
/// `POST /api/upload-intervention-photo`, qui les dépouille de leur EXIF et
/// rend un chemin. Les lignes `photos`, elles, ne naissent qu'à la validation :
/// `photos.intervention_id` est NOT NULL, l'ordre inverse est impossible.
///
/// Conséquence assumée : un tunnel abandonné laisse des fichiers sans ligne.
/// Ils ne sont référencés par rien et le quota de l'endpoint borne le disque.
///
/// ── Géométrie portée
///
///   · zone de dépôt `border-2 border-dashed rounded-xl p-8`, colonne centrée,
///     pastille d'icône 48 px `rounded-full mb-3`, mention de format en 12 px ;
///   · la maquette annonce « Glissez vos photos ici » : le dépôt par glisser
///     est donc **implémenté**, pas seulement dessiné. Un champ qui invite à un
///     geste qu'il refuse est pire qu'un champ nu.
///
/// ── L'aperçu ne survit pas au rechargement, et c'est dit
///
/// La prévisualisation utilise l'objet local du navigateur (`blob:`), pas le
/// fichier stocké : `uploads/` n'est pas servi par Next. Cette URL ne vaut que
/// pour le document qui l'a créée - au retour d'un aller-retour d'inscription,
/// la photo est toujours là côté serveur mais son aperçu ne l'est plus. La
/// vignette cède alors la place au nom du fichier, plutôt qu'à une image
/// cassée.

const MAX_PHOTOS = 5;

const FORMATS = "image/jpeg,image/png,image/webp,image/heic,image/heif";

type PhotoDeposee = {
  /// Chemin rendu par le serveur - c'est lui qui part à la validation.
  url: string;
  /// URL d'objet local, pour l'aperçu. Vide après une reprise de session.
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
  const [survol, setSurvol] = useState(false);
  const champRef = useRef<HTMLInputElement>(null);
  const idChamp = useId();

  const complet = photos.length >= MAX_PHOTOS;

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
        setErreur(donnees.message ?? "L'envoi a échoué, réessayez.");
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
    // aucun `change` - la valeur de l'input n'aurait pas varié.
    if (champRef.current) champRef.current.value = "";
  }

  function retirer(url: string) {
    const partante = photos.find((photo) => photo.url === url);
    if (partante?.apercu) URL.revokeObjectURL(partante.apercu);
    onChangement(photos.filter((photo) => photo.url !== url));
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-xl font-bold tracking-[-0.01em]">
          Photos préparatoires{" "}
          <span className="text-sm font-normal text-muted-foreground">
            (facultatif)
          </span>
        </h2>
        <p className="text-sm leading-[1.5] text-muted-foreground">
          Aidez le technicien à préparer son intervention en ajoutant des photos
          de votre vélo : usure, casse, pièce à remplacer.
        </p>
      </div>

      {/* `<label>` et non `<div onClick>` : c'est ce qui rend la zone
          activable au clavier, puisqu'elle commande un vrai champ de fichier. */}
      <label
        htmlFor={idChamp}
        onDragOver={(evenement) => {
          evenement.preventDefault();
          setSurvol(true);
        }}
        onDragLeave={() => {
          setSurvol(false);
        }}
        onDrop={(evenement) => {
          evenement.preventDefault();
          setSurvol(false);
          if (!complet && !enCours) void deposer(evenement.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-input bg-secondary/50 p-8 text-center transition-colors",
          "has-[:focus-visible]:border-primary has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
          complet || enCours
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer hover:border-primary/50",
          survol && "border-primary bg-primary-fixed/30",
        )}
      >
        <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary-fixed/40">
          <UploadCloud aria-hidden="true" className="size-6 text-primary" />
        </span>

        <span className="text-sm font-semibold tracking-[0.05em]">
          Glissez vos photos ici
        </span>
        <span className="text-sm text-muted-foreground">
          ou{" "}
          <span className="text-primary underline">parcourez vos fichiers</span>
        </span>
        <span className="mt-2 text-xs text-muted-foreground">
          JPG, PNG, WEBP ou HEIC, 5 Mo maximum, {MAX_PHOTOS} photos au plus.
        </span>

        <input
          ref={champRef}
          id={idChamp}
          type="file"
          accept={FORMATS}
          multiple
          className="sr-only"
          disabled={enCours || complet}
          onChange={(evenement) => {
            void deposer(evenement.target.files);
          }}
        />
      </label>

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
            <li key={photo.url} className="relative">
              {photo.apercu ? (
                /* `<img>` et non `next/image` : la source est un objet local
                   (`blob:`), que l'optimiseur de Next ne sait pas traiter et
                   n'aurait aucune raison de traiter - l'image ne quitte pas le
                   navigateur. */
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={photo.apercu}
                  alt={`Aperçu de ${photo.nom}`}
                  width={96}
                  height={96}
                  className="size-24 rounded-xl border border-border object-cover"
                />
              ) : (
                <span className="flex size-24 flex-col items-center justify-center gap-1 rounded-xl border border-border bg-secondary p-2 text-center">
                  <ImageIcon
                    aria-hidden="true"
                    className="size-6 text-muted-foreground"
                  />
                  <span className="line-clamp-2 text-xs break-all text-muted-foreground">
                    {photo.nom}
                  </span>
                </span>
              )}

              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                className="absolute -top-2 -right-2 rounded-full shadow-sm"
                onClick={() => {
                  retirer(photo.url);
                }}
              >
                <X aria-hidden="true" className="size-4" />
                <span className="sr-only">Retirer {photo.nom}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export type { PhotoDeposee };
