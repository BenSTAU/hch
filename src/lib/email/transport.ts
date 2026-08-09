import "server-only";

import { createTransport } from "nodemailer";

import { serverEnv } from "@/lib/env";

/// Transport email — ADR-017. Gmail par mot de passe d'application quand
/// `HCH_MAIL_TRANSPORT=gmail`, transport no-op qui logge le lien partout
/// ailleurs (poste de développement, barrière E2E).
///
/// Le no-op n'est pas un bouchon de confort : c'est lui qui rend l'inscription
/// jouable à la main sans boîte email, et c'est lui qui garantit que l'E2E ne
/// dépend d'aucun transport — la propriété qui compte (ADR-017 §Contraintes).

/// Le `from` n'est pas `@glanford.eu` : le compte émetteur est un Gmail
/// personnel (ADR-017 §Compte émetteur). C'est le NOM affiché qui porte la
/// marque, l'adresse reste visible en second rideau.
export const MAIL_SENDER_NAME = "HomeCycl'Home";

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/// Envoie, ou **lève**. Jamais de `catch` silencieux : un envoi raté à
/// l'inscription laisse un compte créé et jamais activable, et le client n'a
/// aucun recours. Si Google révoque le mot de passe d'application — ce qu'il
/// fait sans préavis — les six emails de la v1 tombent d'un coup, et c'est
/// cette exception qui le fera voir.
export async function sendEmail(email: OutgoingEmail): Promise<void> {
  const { mail } = serverEnv();

  if (mail.transport === "noop") {
    // Deux arguments : le second porte le corps en texte brut, donc le lien.
    console.info(`[email:noop] ${email.subject} → ${email.to}`, email.text);
    return;
  }

  const transporter = createTransport({
    service: "gmail",
    auth: { user: mail.fromAddress, pass: mail.appPassword },
  });

  try {
    await transporter.sendMail({
      from: `"${MAIL_SENDER_NAME}" <${mail.fromAddress}>`,
      replyTo: mail.fromAddress,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  } catch (error) {
    // Le détail part dans les logs du conteneur, jamais dans le message relancé :
    // une erreur SMTP porte l'hôte, le compte et parfois la valeur refusée, et
    // ce message-là traverse `handleServerError` puis remonte au navigateur.
    console.error("[email] envoi impossible :", error);
    throw new Error(`Envoi impossible vers ${email.to}`, { cause: error });
  }
}
