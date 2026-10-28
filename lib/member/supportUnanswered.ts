// ⏰ MESSAGE SANS RÉPONSE (28/10/2026, audit du support).
//
// Sur 15 jours, ~41 lots de messages clients n'ont jamais eu de réponse, et ~204 ont attendu plus de 3 h (≈ 13 par
// jour, pics à 40 le 18/10 et 28 le 22/10). Une carte sans proposition, un passage tombé, un « à toi » oublié : rien ne
// le signalait. Toutes les 15 min, un résumé part chez les admins par l'alerte existante (notifyOwner : DM Telegram,
// push en secours) quand le DERNIER message d'une conversation attend depuis plus de N heures.
//
// Réglage : support_settings 'unanswered_alert_hours' (nombre d'heures, ou 'off'), relu à chaque passage, sans
// redéploiement. Ligne absente = 3 h (UNANSWERED_DEFAULT_HOURS). Rien n'est écrit dans support_settings par le code.
// Une seule alerte par message en attente : la trace est une ligne support_jobs (kind 'unanswered_alert', status
// 'done', jamais reprise par la cron), comme les relances. Rien n'est écrit sur la ligne du message client (le
// brouillon en cours l'écrase).
import { notifyOwner } from './notifyOwner';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const UNANSWERED_DEFAULT_HOURS = 3;
export const UNANSWERED_SETTING = 'unanswered_alert_hours';
const WINDOW_MS = 24 * 3_600_000;
const BIZ_KIND = 'biz_msg';
// ce que le bot envoie de lui-même et qui ne RÉPOND à rien (même liste que supportAuto)
const NOT_AN_ANSWER = new Set(['welcome', 'country_voice', 'intro', 'link', 'live_welcome', 'followup']);
// traité sans réponse : rien à répondre (« ok », « merci »), spam, carte écartée par Mathieu
const HANDLED_INTENT = new Set(['skip', 'spam', 'live']);

/** 'off' / '0' → coupé (null). Un nombre entre 1 et 48 → ce nombre. Absent ou illisible → 3. */
export function parseAlertHours(v: string | null | undefined): number | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return UNANSWERED_DEFAULT_HOURS;
  if (s === 'off' || s === '0') return null;
  const n = Number(s.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return UNANSWERED_DEFAULT_HOURS;
  return Math.min(48, Math.max(1, n));
}

export type ChatRow = { id: string; tg_id: number; member_no?: number | null; created_at: string; detail: Record<string, unknown> };
export type Waiting = { tgId: number; rowId: string; memberNo: number | null; since: string; text: string; name: string };

/** Les conversations dont le dernier message client attend depuis plus de `hours` (lignes triées par date). */
export function unansweredChats(rows: ChatRow[], now: number, hours: number): Waiting[] {
  const chats = new Map<number, ChatRow[]>();
  for (const r of rows) {
    const k = Number(r.tg_id);
    if (!chats.has(k)) chats.set(k, []);
    chats.get(k)!.push(r);
  }
  const out: Waiting[] = [];
  for (const [tgId, list] of chats) {
    let lastClient = -1;
    list.forEach((r, k) => { if (r.detail?.from === 'client') lastClient = k; });
    if (lastClient < 0) continue;
    const c = list[lastClient];
    const answered = list.slice(lastClient + 1).some((r) => r.detail?.from === 'owner' && !NOT_AN_ANSWER.has(String(r.detail?.via ?? '')));
    if (answered) continue;
    const d = c.detail ?? {};
    if (d.answered_at || d.draft_dismissed_at || HANDLED_INTENT.has(String(d.draft_intent ?? ''))) continue;
    const text = String(d.text ?? '');
    if (text.startsWith('[sticker')) continue;
    const at = Date.parse(c.created_at);
    if (now - at < hours * 3_600_000) continue;
    out.push({ tgId, rowId: String(c.id), memberNo: c.member_no ?? null, since: c.created_at, text, name: String(d.name ?? d.username ?? '') });
  }
  return out.sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
}

const ago = (since: string, now: number) => {
  const h = Math.floor((now - Date.parse(since)) / 3_600_000);
  return h >= 1 ? `${h} h` : `${Math.round((now - Date.parse(since)) / 60_000)} min`;
};

/** Le passage (toutes les 15 min depuis runSupportJobs). Retourne le nombre de conversations signalées. */
export async function runUnansweredAlert(db: Db, now = Date.now()): Promise<number> {
  const { data: s } = await db.from('support_settings').select('value').eq('key', UNANSWERED_SETTING).limit(1);
  const hours = parseAlertHours(s?.[0]?.value ?? null);
  if (hours == null) return 0;
  const { data } = await db.from('member_actions').select('id,tg_id,member_no,created_at,detail').eq('kind', BIZ_KIND).gte('created_at', new Date(now - WINDOW_MS).toISOString()).order('created_at', { ascending: true }).limit(3000);
  let waiting = unansweredChats((data ?? []) as ChatRow[], now, hours);
  if (!waiting.length) return 0;
  // déjà signalé (même message) : pas deux fois
  const { data: done } = await db.from('support_jobs').select('payload').eq('kind', 'unanswered_alert').gte('created_at', new Date(now - 2 * WINDOW_MS).toISOString()).limit(1000);
  const seen = new Set(((done ?? []) as Array<{ payload?: { row?: string } }>).map((j) => String(j.payload?.row ?? '')));
  waiting = waiting.filter((w) => !seen.has(w.rowId));
  // les membres bannis ne comptent pas
  if (waiting.length) {
    const { data: banned } = await db.from('members').select('tg_id').in('tg_id', waiting.map((w) => w.tgId)).not('banned_at', 'is', null);
    const out = new Set(((banned ?? []) as Array<{ tg_id: number }>).map((b) => Number(b.tg_id)));
    waiting = waiting.filter((w) => !out.has(w.tgId));
  }
  if (!waiting.length) return 0;
  // la trace d'abord : une panne de Telegram ne doit pas relancer l'alerte toutes les 15 min
  await db.from('support_jobs').insert(waiting.map((w) => ({ tg_id: w.tgId, conn: '', kind: 'unanswered_alert', due_at: new Date(now).toISOString(), status: 'done', payload: { row: w.rowId, hours }, result: { outcome: 'unanswered_alert' } })));
  const shown = waiting.slice(0, 10);
  await notifyOwner({
    title: `⏰ ${waiting.length} message${waiting.length > 1 ? 's' : ''} sans réponse depuis plus de ${hours} h`,
    lines: [
      ...shown.map((w) => `${w.name || `tg ${w.tgId}`}${w.memberNo != null ? ` · #${w.memberNo}` : ''} · ${ago(w.since, now)} : « ${(w.text || '(média)').replace(/\s+/g, ' ').slice(0, 80)} »`),
      waiting.length > shown.length ? `… et ${waiting.length - shown.length} autre(s).` : '',
    ],
    tag: 'support-unanswered',
  });
  return waiting.length;
}
