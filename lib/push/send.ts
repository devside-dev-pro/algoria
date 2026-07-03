// ÉMETTEUR Web Push partagé (runner Railway + API routes Vercel) — la sensation « vraie app » de la PWA.
// Règle broadcast 70/30 : on ne pousse QUE du positif ou du neutre (wins, recap vert, alerte live) — jamais une perte.
//
// Env (Railway ET Vercel, server-only) :
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY — paire générée via `npx web-push generate-vapid-keys`
//   VAPID_SUBJECT — contact (ex. mailto:contact@algoria.tech)
// Env Vercel (client) : NEXT_PUBLIC_VAPID_PUBLIC_KEY = la même clé publique.
import webpush from 'web-push';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface PushPayload {
  title: string;
  body: string;
  url?: string; // ouverte au tap (défaut /member)
  tag?: string; // regroupe/remplace les notifs de même type
}

let ready = false;
function configure(): boolean {
  if (ready) return true;
  const pub = process.env.VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false; // pas configuré → no-op silencieux (ne casse jamais le trading)
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:contact@algoria.tech', pub, priv);
  ready = true;
  return true;
}

let _db: SupabaseClient | null = null;
const pdb = (): SupabaseClient => {
  if (!_db) _db = createClient(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
  return _db;
};

/** Envoie à TOUS les appareils abonnés. Nettoie les abonnements morts (410/404). Retourne le nb délivré. */
export async function pushToAll(payload: PushPayload): Promise<number> {
  if (!configure()) return 0;
  const db = pdb();
  const { data: subs } = await db.from('member_push_subs').select('endpoint,p256dh,auth');
  if (!subs?.length) return 0;
  const body = JSON.stringify(payload);
  const gone: string[] = [];
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 3600 });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) gone.push(s.endpoint); // appareil désabonné → on nettoie
      }
    }),
  );
  if (gone.length) await db.from('member_push_subs').delete().in('endpoint', gone);
  return sent;
}
