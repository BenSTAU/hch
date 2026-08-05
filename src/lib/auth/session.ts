import "server-only";

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "hch_session";

const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 jours (ADR-005 v2)

// `SESSION_SECRET` et non `AUTH_SECRET` : c'est le nom que PLAN S3 §6 donne au
// secret scopé par GitHub Environment, et celui déjà commité dans
// `.env.prod.example`. ADR-005 v2 écrit `AUTH_SECRET` — écart signalé en PR.
function secret(): Uint8Array {
  const value = process.env["SESSION_SECRET"];
  if (!value) {
    // Échec explicite au premier appel plutôt qu'une signature avec une clé
    // vide, qui produirait des sessions que n'importe qui peut forger.
    throw new Error(
      "SESSION_SECRET absente : impossible de signer une session. " +
        "La renseigner dans .env.local (poste) ou le .env.prod de la pile (VPS).",
    );
  }
  return new TextEncoder().encode(value);
}

export type SessionPayload = {
  sub: string;
  roles: string[];
};

export async function createSession(
  userId: string,
  roles: string[],
): Promise<void> {
  const token = await new SignJWT({ roles })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, // inaccessible à document.cookie — pas de vol par XSS
    secure: true, // jamais en clair sur le réseau
    sameSite: "lax", // bloque le CSRF en POST cross-site, laisse passer les liens
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/// Lit et **vérifie** le jeton. Toute anomalie — absence, signature invalide,
/// expiration, charge utile inattendue — renvoie `null` sans distinction :
/// l'appelant n'a qu'une question à se poser, « ai-je une session ou non ».
export async function readSessionToken(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    // `algorithms` épinglé : sans lui, jose accepte HS256, HS384 **et** HS512
    // alors que `createSession` n'émet que du HS256. La surface acceptée doit
    // être exactement la surface émise — durcissement OWASP standard, relevé
    // par l'agent testeur sur T-J0-04.
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
    });
    const sub = payload.sub;
    const roles = payload["roles"];
    // `sub` non vide : la chaîne vide est une chaîne, et elle traverserait le
    // `typeof`. Elle atteindrait `findUserById("")` sur une colonne UUID, que
    // Postgres rejette en 22P02 — une erreur 500 là où une redirection est
    // attendue.
    if (typeof sub !== "string" || sub.length === 0) return null;
    if (!Array.isArray(roles)) return null;
    return {
      sub,
      roles: roles.filter((r): r is string => typeof r === "string"),
    };
  } catch {
    return null;
  }
}
