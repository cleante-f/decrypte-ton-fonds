// Cloudflare Pages Functions : contrôle d'accès du simulateur (logique et tests dans serveur/acces.js).
import { controlerAcces } from "../serveur/acces.js";

export const onRequest = contexte =>
  controlerAcces(contexte.request, contexte.env, () => contexte.next(), { cache: caches.default });
