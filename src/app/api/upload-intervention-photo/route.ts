import { NextResponse } from "next/server";

import { getOptionalUser } from "@/lib/auth/dal";
import { enregistrerPhoto, messageRefus } from "@/lib/photos/stockage";
import {
  consumeRateLimit,
  UPLOAD_LIMIT,
  UPLOAD_WINDOW_MS,
  uploadRateLimitKey,
} from "@/lib/rate-limit";

/// Dépôt d'une photo du tunnel - l'un des **trois** Route Handlers que
/// CLAUDE.md autorise, avec le callback OAuth et l'initiation Google.
///
/// Route Handler et non Server Action, parce qu'il reçoit un fichier : une
/// Server Action sérialise sa charge utile, et faire transiter cinq images de
/// cinq mégaoctets par ce canal serait un détournement de mécanisme.
///
/// **Il exige une session**, et ce n'est pas une contrainte reprise du tunnel
/// par mimétisme : sans elle, n'importe qui écrirait des fichiers sur le disque
/// du serveur sans compte ni traçabilité. La règle du 2026-08-09 la rend
/// naturelle : les photos se déposent au récapitulatif, écran qui n'est
/// atteignable qu'une fois connecté.
///
/// Le quota des cinq photos par intervention n'est PAS tenu ici : à ce stade
/// l'intervention n'existe pas encore. Il est vérifié à la validation, seule
/// surface qui connaisse le dossier complet.

export async function POST(requete: Request): Promise<NextResponse> {
  const utilisateur = await getOptionalUser();
  if (!utilisateur) {
    // 401 en JSON, pas une redirection : l'appelant est un `fetch`, pas une
    // navigation. Une redirection lui rendrait du HTML qu'il ne sait pas lire.
    return NextResponse.json(
      { ok: false, message: "Connectez-vous pour joindre des photos." },
      { status: 401 },
    );
  }

  // Le quota borne le DISQUE, pas le dossier : celui des cinq photos par
  // intervention ne mord qu'à la validation, et rien ne ramasse les fichiers
  // d'un tunnel abandonné. Décompté AVANT de lire le corps. Accepter cinq
  // mégaoctets pour les refuser ensuite ne protégerait rien.
  const verdict = await consumeRateLimit(
    uploadRateLimitKey(utilisateur.id),
    UPLOAD_LIMIT,
    UPLOAD_WINDOW_MS,
  );

  if (!verdict.allowed) {
    return NextResponse.json(
      { ok: false, message: "Trop de photos envoyées. Réessayez plus tard." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(verdict.retryAfterMs / 1000)),
        },
      },
    );
  }

  const formulaire = await requete.formData();
  const fichier = formulaire.get("photo");

  if (!(fichier instanceof File)) {
    return NextResponse.json(
      { ok: false, message: "Aucun fichier reçu." },
      { status: 400 },
    );
  }

  const resultat = await enregistrerPhoto(fichier);

  if (!resultat.ok) {
    // 413 pour le dépassement de poids, 415 pour un format refusé : ce sont les
    // codes que ces deux refus portent, et un 400 générique priverait le client
    // de la distinction.
    const statut =
      resultat.reason === "trop_lourde"
        ? 413
        : resultat.reason === "type_refuse"
          ? 415
          : 422;

    return NextResponse.json(
      { ok: false, message: messageRefus(resultat.reason) },
      { status: statut },
    );
  }

  return NextResponse.json({ ok: true, url: resultat.url });
}

/// Le décodage puis le ré-encodage d'une image de cinq mégaoctets dépassent
/// largement le défaut de Next sur une machine chargée.
export const maxDuration = 30;
