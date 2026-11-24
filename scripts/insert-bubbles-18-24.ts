/**
 * Insertion des 24 bulles du calendrier 18–24 nov 2026 (channel_posts, slot bubble1–4).
 *
 * Par défaut : dry-run (affiche les lignes, n'écrit rien).
 * Pour écrire en base : `npx tsx scripts/insert-bubbles-18-24.ts --apply`
 *   — seulement avec l'OK de Mathieu. Jamais de DELETE. WHERE NOT EXISTS sur (day, slot).
 *
 * Ne lance PAS ce script au déploiement. Le message de 11:30 ne part que si les lignes
 * existent et que le kill-switch n'est pas à off. Pas de DM live, pas de relance.
 */
import { bubbleInsertRows } from '../lib/channel/bubbles.week';

async function main() {
  const rows = bubbleInsertRows();
  const apply = process.argv.includes('--apply');
  console.log(`${rows.length} bulles, ${apply ? 'APPLY' : 'dry-run'}`);
  for (const r of rows) {
    console.log(`${r.day} ${r.slot} ${r.scheduled_at} ${r.report.mode} ${r.report.subject.slice(0, 60)}`);
  }
  if (!apply) {
    console.log('Dry-run. Relancer avec --apply seulement après OK de Mathieu (aucune suppression).');
    return;
  }
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY manquants');
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(url, key, { auth: { persistSession: false } });
  let inserted = 0, skipped = 0;
  for (const r of rows) {
    const { data: exists } = await db.from('channel_posts').select('id').eq('day', r.day).eq('slot', r.slot).limit(1);
    if (exists?.length) { skipped++; continue; }
    const { error } = await db.from('channel_posts').insert(r);
    if (error) throw new Error(`${r.day} ${r.slot}: ${error.message}`);
    inserted++;
  }
  console.log(`insérées ${inserted}, déjà présentes ${skipped}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
