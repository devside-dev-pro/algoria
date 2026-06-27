// Vérifie les variables d'env AVANT toute connexion (sync.ts crée le client Supabase dès l'import).
// Importé en 2e dans index.ts (après dotenv) → s'exécute avant tout le reste.
const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'METAAPI_TOKEN', 'METAAPI_ACCOUNT_ID'] as const;

const report = REQUIRED.map((k) => `${k}=${process.env[k] ? 'OK' : '❌MANQUANT'}`).join(' · ');
console.log('[algoria] env check ·', report);

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[algoria] ARRÊT : variable(s) manquante(s) → ${missing.join(', ')}.`);
  console.error('[algoria] → Railway → service algoria → Variables : vérifie qu\'elles sont bien APPLIQUÉES (pas juste "staged"), puis Redeploy.');
  process.exit(1);
}
