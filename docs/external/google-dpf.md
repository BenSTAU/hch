# Google LLC et le Data Privacy Framework

Source matérialisée pour `/politique-confidentialite` (T-V3-12). CLAUDE.md
§Cite or don't claim interdit de citer une doc externe sans la déposer ici.

**Pourquoi cette page existe** : la politique de confidentialité déclare un
transfert de données personnelles vers Google LLC (États-Unis). Le fondement de
ce transfert doit être vérifiable, pas affirmé de mémoire.

## Ce qui a été consulté le 2026-08-11

| Source                                                                                    | Résultat                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `https://www.dataprivacyframework.gov/list` (liste officielle du Département du Commerce) | **Non consultable par récupération HTTP** : la page est une application monopage, elle ne rend que son titre sans exécution de JavaScript. Aucune ligne de participant n'a pu être lue |
| `https://www.dataprivacyframework.gov/Google`                                             | Idem, aucun contenu substantiel rendu                                                                                                                                                  |
| `https://policies.google.com/privacy/frameworks`                                          | Consultable. Déclaration de Google elle-même                                                                                                                                           |

Citation exacte de la troisième source :

> « Google LLC (and its wholly-owned US subsidiaries unless explicitly excluded)
> has certified that it adheres to the DPF Principles. »

et

> « we comply with the EU-U.S. and Swiss-U.S. Data Privacy Frameworks (DPF) and
> the UK Extension to the EU-U.S. DPF »

## Ce que le dépôt a le droit d'affirmer

Ce qui est **vérifié** : Google LLC déclare publiquement adhérer au cadre
EU-U.S. DPF et se dit certifiée auprès du Département du Commerce des
États-Unis.

Ce qui **ne l'est pas** : la présence de Google LLC en statut _Active_ sur la
liste officielle, à la date d'aujourd'hui. C'est la déclaration de l'organisme
qui a été lue, pas le registre qui l'enregistre.

La politique de confidentialité écrit donc « déclare adhérer », et non « est
certifiée ». La nuance n'est pas cosmétique : une certification DPF se retire,
et une page qui affirme un statut de registre qu'elle n'a pas lu affirme
davantage que ce qu'elle sait.

> [!todo-verify] Statut _Active_ sur la liste officielle
> À confirmer par une consultation manuelle de
> `dataprivacyframework.gov/list` dans un navigateur, en cherchant
> « Google LLC ». Si le statut est _Active_, la formulation de la page peut
> passer à « certifiée ». Si Google devait sortir de la liste, c'est la base
> légale du transfert qui change, pas seulement le libellé.

## Ce qui est transféré, et pourquoi

Le transfert ne vient **pas** de Google Maps. ADR-015 v2 a retiré le fond de
carte du parcours client le 2026-08-08, et le back-office administrateur qui en
garde l'usage n'est pas livré. Le transfert réel et actuel est le **transport
email** : ADR-017 fait passer les messages transactionnels par Gmail
(`src/lib/email/transport.ts`), donc l'adresse email du destinataire et le
contenu du message sont traités par Google LLC.

Aucune section RGPD du vault ne le mentionne - S4 §4.2 liste encore
« destinataires (Google Maps §6 pour géocodage) », ligne antérieure à
ADR-015 v2. Signalé pour write-back.
