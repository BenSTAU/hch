import "server-only";

import { serverEnv } from "@/lib/env";

import { sendEmail } from "./transport";

/// Email d'activation — le premier des six emails de la v1 (ADR-017
/// §Périmètre). Son contenu n'était tranché nulle part : la SPEC le renvoyait au
/// PLAN (module-1-utilisateurs.md:196), qui ne l'a jamais écrit. Ce que la SPEC
/// contraint réellement, c'est le TTL de 24 h et le fait que le lien porte le
/// jeton en clair.

const SUJET = "Activez votre compte HomeCycl'Home";

/// Route en **français** - `/activation` et non le `/auth/verify` de la SPEC,
/// CLAUDE.md §Folder structure imposant les routes en français. Écart à verser
/// au write-back.
/// `next` voyage **dans le lien** et non dans un état navigateur : le lien
/// s'ouvre souvent sur un autre appareil que celui où le tunnel a été composé.
/// Ce qui voyage est l'INTENTION de revenir, jamais la sélection, qui vit en
/// `sessionStorage`. Déjà passé par `safeNextPath` à l'inscription, donc c'est
/// un chemin interne.
export function activationUrl(token: string, next?: string): string {
  const base = serverEnv().appUrl.replace(/\/+$/, "");
  const suffixe = next ? `&next=${encodeURIComponent(next)}` : "";
  return `${base}/activation?token=${encodeURIComponent(token)}${suffixe}`;
}

/// `firstname` vient d'un formulaire public. Les clients de messagerie modernes
/// n'exécutent pas de script, mais ils interprètent le balisage : une valeur non
/// échappée casse la mise en page, et rien ne garantit le comportement d'un
/// webmail plus permissif.
function echapper(valeur: string): string {
  return valeur
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendActivationEmail(params: {
  to: string;
  firstname: string;
  token: string;
  next?: string;
}): Promise<void> {
  const lien = activationUrl(params.token, params.next);

  // Le texte brut n'est pas décoratif : c'est ce que logge le transport no-op, et
  // c'est le repli des clients de messagerie qui refusent le HTML.
  const text = [
    `Bonjour ${params.firstname},`,
    "",
    "Activez votre compte HomeCycl'Home en ouvrant ce lien :",
    lien,
    "",
    "Ce lien est valable 24 heures. Passé ce délai, demandez-en un nouveau",
    "depuis la page de connexion.",
    "",
    "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
  ].join("\n");

  const html = [
    `<p>Bonjour ${echapper(params.firstname)},</p>`,
    `<p>Activez votre compte HomeCycl'Home :</p>`,
    `<p><a href="${lien}">Activer mon compte</a></p>`,
    `<p>Ce lien est valable 24 heures. Passé ce délai, demandez-en un nouveau depuis la page de connexion.</p>`,
    `<p>Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p>`,
  ].join("\n");

  await sendEmail({ to: params.to, subject: SUJET, text, html });
}
