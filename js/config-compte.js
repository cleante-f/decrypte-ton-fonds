// Réglages publics du module de compte. Aucun secret ici : la clé « publishable » de Supabase et la clé de site Turnstile
// sont faites pour être publiques ; la sécurité repose sur les règles d'accès de la base (RLS).
// Les valeurs [[…]] doivent être remplacées avant publication : verifier.py bloque tant qu'il en reste.
const CONFIG_COMPTE = {
  supabaseUrl: "[[SUPABASE_URL]]",                 // https://<ref>.supabase.co
  supabaseCle: "[[SUPABASE_PUBLISHABLE_KEY]]",     // clé publique (sb_publishable_…)
  turnstileCle: "1x00000000000000000000AA",        // clé de TEST Turnstile (toujours valide) ; la vraie clé à la tâche 11
  prixAffiche: "[[PRIX]]",                         // ex. « 4,99 € par mois »
  versionCgv: "2026-10",
  simulationsOffertes: 3
};
