// ALERTE PROPRIÉTAIRE — ce que Mathieu doit savoir sans ouvrir l'admin (03/09/2026).
//
// Constat de l'audit produit (docs/AUDIT-PRODUIT.md §1) : aucun événement métier ne prévenait personne.
// Un membre qui finissait son dossier, déclarait son lot d'activation, demandait un retrait ou écrivait au
// bot n'était visible qu'en ouvrant le dashboard — « je n'ai même pas le temps de les voir ». Le 03/09,
// six dossiers attendaient, le plus vieux depuis huit jours.
//
// Deux canaux, envoyés ensemble, parce qu'aucun des deux n'est fiable seul :
//   · DM Telegram par le bot, aux admins (ADMIN_TG_USERNAMES → members.tg_username → tg_id, ou OWNER_TG_IDS
//     en direct — plus sûr, ne dépend pas d'une fiche membre) ;
//   · Web Push (pushToAdmins), qui ne marche que si l'admin a activé les notifications depuis l'app.
// Best effort, jamais bloquant : une alerte qui échoue ne doit pas casser l'action du membre.
//
// LES LIENS SONT ABSOLUS vers admin.algoria.tech. Les alertes techniques pointaient sur `/member/admin`
// (page morte) ou `/admin` (réécrit en `/member/admin` sur app.algoria.tech par le middleware → boucle).
import { pushToAdmins } from '../push/send';

export const ADMIN_URL = (process.env.ADMIN_URL ?? 'https://admin.algoria.tech').replace(/\/$/, '');
export const adminLink = (path = '/'): string => `${ADMIN_URL}${path.startsWith('/') ? path : `/${path}`}`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Identifiants Telegram des admins : OWNER_TG_IDS (liste de nombres) puis ADMIN_TG_USERNAMES résolus en base. */
export async function adminTgIds(): Promise<number[]> {
  const direct = (process.env.OWNER_TG_IDS ?? '').split(/[\s,]+/).map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0);
  const names = (process.env.ADMIN_TG_USERNAMES ?? '').split(/[\s,@]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!names.length) return direct;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) return direct;
    const db = createClient(url, key, { auth: { persistSession: false } });
    const { data } = await db.from('members').select('tg_id,tg_username').in('tg_username', names);
    const fromDb = (data ?? []).filter((m) => m.tg_username && names.includes(String(m.tg_username).toLowerCase())).map((m) => Number(m.tg_id));
    return [...new Set([...direct, ...fromDb])];
  } catch {
    return direct;
  }
}

export interface OwnerAlert {
  title: string; // une ligne, avec l'emoji qui dit de quoi il s'agit
  lines?: string[]; // détail, une info par ligne (pseudo, broker, montant…)
  path?: string; // page admin à ouvrir (défaut : la racine)
  tag: string; // regroupe les pushs de même nature
  /** Boutons d'action dans le DM (callback_data, traités par le webhook Telegram). Ex. « Envoyer la réponse ». */
  buttons?: Array<{ text: string; data: string }>;
}

/** Envoie l'alerte aux admins (DM Telegram + push). Retourne ce qui est parti ; n'échoue jamais. */
export async function notifyOwner(a: OwnerAlert): Promise<{ dm: number; push: number }> {
  const url = adminLink(a.path ?? '/');
  const body = (a.lines ?? []).filter(Boolean).join('\n');
  let dm = 0, push = 0;
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const ids = await adminTgIds();
    if (token && ids.length) {
      const text = `<b>${esc(a.title)}</b>${body ? `\n${esc(body)}` : ''}`;
      await Promise.all(ids.map(async (chat_id) => {
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(4000),
          body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: [...(a.buttons?.length ? [a.buttons.map((b) => ({ text: b.text, callback_data: b.data.slice(0, 64) }))] : []), [{ text: 'Ouvrir l’admin', url }]] } }),
        }).catch(() => null);
        if (r?.ok) dm++;
      }));
    }
  } catch { /* best effort */ }
  try {
    push = await pushToAdmins({ title: a.title, body: body.slice(0, 240), url, tag: a.tag });
  } catch { /* best effort */ }
  return { dm, push };
}
