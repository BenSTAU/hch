"use client";

import { useEffect, useState } from "react";

/// Message de confirmation après une action qui a redirigé.
///
/// ⚠️ **Client, et monté APRÈS l'hydratation, délibérément.** Une région
/// `role="status"` rendue côté serveur avec son contenu existe déjà peuplée au
/// chargement : les lecteurs d'écran annoncent les **mutations** d'une région
/// live, pas son contenu initial, et le message serait donc probablement muet.
/// L'injecter après le montage produit la mutation qui le fait annoncer.
/// Relevé par l'agent testeur (A3).
///
/// La région reste dans le flux même vide - une région live révélée en même
/// temps que son contenu n'est pas annoncée de façon fiable.
export function MessageFlash({ message }: { message: string }) {
  const [annonce, setAnnonce] = useState("");

  // Le report d'un tour de boucle n'est pas un contournement du lint : une
  // région live peuplée dans le même temps de rendu que son apparition n'est
  // pas annoncée de façon fiable, et c'est exactement ce que corrige ce
  // composant.
  useEffect(() => {
    const minuteur = setTimeout(() => {
      setAnnonce(message);
    }, 0);

    return () => {
      clearTimeout(minuteur);
    };
  }, [message]);

  return (
    <p role="status" className="text-sm text-muted-foreground">
      {annonce}
    </p>
  );
}
