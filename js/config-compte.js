// Réglages publics du module de compte. Aucun secret ici : la clé « publishable » de Supabase et la clé de site Turnstile
// sont faites pour être publiques ; la sécurité repose sur les règles d'accès de la base (RLS).
// Les valeurs [[…]] doivent être remplacées avant publication : verifier.py bloque tant qu'il en reste.
// Rangé dans globalThis pour être lu aussi par le contrôle d'accès de Cloudflare (functions/_middleware.js),
// qui l'importe comme module : une simple « const » y resterait locale.
globalThis.CONFIG_COMPTE = {
  supabaseUrl: "https://njykqalgjwhcuosrpaje.supabase.co",                 // https://<ref>.supabase.co
  supabaseCle: "sb_publishable_1PPEjooDcNTXyISuiTvnxQ_M32p6qa1",     // clé publique (sb_publishable_…)
  turnstileCle: "1x00000000000000000000AA",        // clé de TEST Turnstile (toujours valide) ; la vraie clé à la tâche 11
  prixAffiche: "[[PRIX]]",                         // ex. « 4,99 € par mois »
  versionCgv: "2026-10",
  simulationsOffertes: 3
};
