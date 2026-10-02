// Cloudflare Pages Functions : contrôle d'accès du simulateur (logique et tests dans serveur/acces.js).
import "../js/config-compte.js";   // adresse et clé publique de Supabase, si Cloudflare n'a pas de variables
import { controlerAcces } from "../serveur/acces.js";

export const onRequest = contexte =>
  controlerAcces(contexte.request, contexte.env, () => contexte.next(), { cache: caches.default });
