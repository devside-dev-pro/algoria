// DEMANDES DE BULLES VIDÉO À MATHIEU (calendrier 18–24/11, partie D, décision du 17/11/2026).
//
// Les lignes (slot bubble1…bubble4, kind=video, status=info) sont insérées par le script
// scripts/insert-bubbles-18-24.ts — livré, pas exécuté tout seul.
//
//   · PROG : un seul DM « 🎥 Bulles à programmer aujourd'hui » à 09:30 Dubaï en semaine, 10:00 le week-end.
//   · LIVE : un DM 10 minutes avant le créneau (« C'est le moment de faire une bulle… »).
//   · Boutons « ✅ Faite » (rien d'autre ne part) et « ⏭ Pas cette fois » (le texte de remplacement
//     passe en approved et part au créneau, kind reste video pour ne pas bousculer les numéros du plan CM).
//   · Sans réponse 20 minutes après le créneau : rien ne part. On n'auto-valide jamais le remplacement.
//   · Idempotent : report.sent_at sur chaque ligne une fois le DM parti.
//   · Kill-switch : CHANNEL_BUBBLES=off (env) ou support_settings cm_bubbles=off. Pas de nouveau webhook.
// Les DM vont seulement aux admins, via notifyOwner.

import { adminTgIds, notifyOwner } from '@/lib/member/notifyOwner';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type BubbleReport = {
  mode?: 'prog' | 'live';
  theme?: string;
  subject?: string;
  points?: string[];
  duration?: string;
  fallback?: string;
  sent_at?: string;
  faite?: boolean;
  decided_by?: string;
};

export type BubbleRow = {
  id: number;
  day: string;
  slot: string;
  kind: string;
  text: string | null;
  status: string;
  scheduled_at: string;
  report: unknown;
};

const TZ = 'Asia/Dubai';
const PROG_WEEKDAY = '09:30';
const PROG_WEEKEND = '10:00';
const PROG_WINDOW_MS = 90 * 60_000; // cron toutes les 5 min ; 90 min de marge si un passage est raté
const LIVE_LEAD_MS = 10 * 60_000;
const asObj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const reportOf = (r: { report: unknown }): BubbleReport => asObj(r.report) as BubbleReport;

export const isBubbleSlot = (slot: string | null | undefined): boolean => /^bubble[1-4]$/.test(String(slot ?? ''));

export function isBubbleRow(r: { slot?: string; kind?: string; report?: unknown }): boolean {
  if (isBubbleSlot(r.slot)) return true;
  return r.kind === 'video' && (reportOf(r as BubbleRow).mode === 'prog' || reportOf(r as BubbleRow).mode === 'live');
}

export async function bubblesEnabled(db: Db): Promise<boolean> {
  if ((process.env.CHANNEL_BUBBLES ?? '').trim().toLowerCase() === 'off') return false;
  const { data } = await db.from('support_settings').select('value').eq('key', 'cm_bubbles').limit(1);
  return String((data?.[0] as { value?: string } | undefined)?.value ?? 'on').trim().toLowerCase() !== 'off';
}

export function dubaiNow(now = Date.now()): { day: string; hhmm: string; weekday: number; ms: number } {
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday as string] ?? 0;
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hhmm: `${parts.hour}:${parts.minute}`, weekday: wd, ms: now };
}

export const isWeekendDubai = (weekday: number) => weekday === 0 || weekday === 6;
export const progAtFor = (weekday: number) => (isWeekendDubai(weekday) ? PROG_WEEKEND : PROG_WEEKDAY);

const atHm = (day: string, hm: string) => Date.parse(`${day}T${hm}:00+04:00`);

/** Premier passage du cron dans la fenêtre [heure d'envoi, heure + 90 min]. */
export function inProgWindow(now: { day: string; weekday: number; ms: number }): boolean {
  const start = atHm(now.day, progAtFor(now.weekday));
  return now.ms >= start && now.ms < start + PROG_WINDOW_MS;
}

/** Premier passage dans [scheduled_at − 10 min, scheduled_at). */
export function inLiveWindow(scheduledAt: string, nowMs: number): boolean {
  const at = Date.parse(scheduledAt);
  return nowMs >= at - LIVE_LEAD_MS && nowMs < at;
}

export function pendingProg(rows: BubbleRow[]): BubbleRow[] {
  return rows.filter((r) => {
    const rep = reportOf(r);
    return r.status === 'info' && rep.mode === 'prog' && !rep.sent_at && !rep.faite;
  });
}

export function pendingLive(rows: BubbleRow[], nowMs: number): BubbleRow[] {
  return rows.filter((r) => {
    const rep = reportOf(r);
    return r.status === 'info' && rep.mode === 'live' && !rep.sent_at && !rep.faite && inLiveWindow(r.scheduled_at, nowMs);
  });
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dubaiHHMM = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });

const pointsLine = (rep: BubbleReport) => (rep.points ?? []).map((p, i) => `${i + 1}) ${p}`).join(' ');

export function formatProgDm(rows: BubbleRow[]): { title: string; lines: string[]; buttonRows: Array<Array<{ text: string; data: string }>> } {
  const lines: string[] = [];
  const buttonRows: Array<Array<{ text: string; data: string }>> = [];
  for (const r of rows) {
    const rep = reportOf(r);
    const when = dubaiHHMM(r.scheduled_at);
    lines.push('', `${when} · PROG · ${rep.duration ?? ''}`.trim(), rep.subject ?? r.text ?? '', pointsLine(rep));
    buttonRows.push([
      { text: `✅ Faite · ${when}`, data: `cmb:ok:${r.id}` },
      { text: `⏭ Pas cette fois · ${when}`, data: `cmb:no:${r.id}` },
    ]);
  }
  return { title: '🎥 Bulles à programmer aujourd\'hui', lines: lines.filter((l, i) => !(i === 0 && l === '')), buttonRows };
}

export function formatLiveDm(r: BubbleRow): { title: string; lines: string[]; buttonRows: Array<Array<{ text: string; data: string }>> } {
  const rep = reportOf(r);
  const when = dubaiHHMM(r.scheduled_at);
  const pts = pointsLine(rep);
  return {
    title: '🎥 C\'est le moment de faire une bulle',
    lines: [
      `Parle de ${rep.subject ?? r.text ?? 'ce sujet'}.`,
      pts ? `Points : ${pts} · ${rep.duration ?? ''}`.trim() : (rep.duration ?? ''),
      `À publier à ${when} (Dubaï).`,
    ].filter(Boolean),
    buttonRows: [[
      { text: '✅ Faite', data: `cmb:ok:${r.id}` },
      { text: '⏭ Pas cette fois', data: `cmb:no:${r.id}` },
    ]],
  };
}

/** Section du plan de 21:00, à la place de « Idée de bulle » quand des bubble1–4 existent. */
export function renderBubblesPlanSection(rows: Array<{ slot?: string; kind?: string; scheduled_at?: string; report?: unknown; text?: string | null }>): string | null {
  const bubbles = rows.filter(isBubbleRow).sort((a, b) => Date.parse(String(a.scheduled_at)) - Date.parse(String(b.scheduled_at)));
  if (!bubbles.length) return null;
  const lines = ['🎥 <b>Bulles de demain</b>'];
  for (const r of bubbles) {
    const rep = reportOf(r as BubbleRow);
    const when = r.scheduled_at ? dubaiHHMM(r.scheduled_at) : '';
    const mode = rep.mode === 'live' ? 'LIVE' : 'PROG';
    lines.push(`${when} · ${mode} · ${esc(rep.theme ?? '')} — ${esc(rep.subject ?? r.text ?? '')}`);
  }
  return lines.join('\n');
}

async function markSent(db: Db, rows: BubbleRow[], at: string): Promise<void> {
  for (const r of rows) {
    await db.from('channel_posts').update({ report: { ...asObj(r.report), sent_at: at } }).eq('id', r.id);
    r.report = { ...asObj(r.report), sent_at: at };
  }
}

async function loadTodayBubbles(db: Db, day: string): Promise<BubbleRow[]> {
  const { data } = await db.from('channel_posts').select('id,day,slot,kind,text,status,scheduled_at,report').eq('day', day).order('scheduled_at', { ascending: true });
  return ((data ?? []) as BubbleRow[]).filter(isBubbleRow);
}

/** Appelé au début de runDue (cron toutes les 5 min, suffisant pour un LIVE à −10 min). */
export async function sendDueBubbleDms(db: Db, nowMs = Date.now()): Promise<{ prog: number; live: number }> {
  if (!(await bubblesEnabled(db))) return { prog: 0, live: 0 };
  const now = dubaiNow(nowMs);
  const rows = await loadTodayBubbles(db, now.day);
  let prog = 0, live = 0;
  if (inProgWindow(now)) {
    const due = pendingProg(rows);
    if (due.length) {
      const dm = formatProgDm(due);
      await notifyOwner({ title: dm.title, lines: dm.lines, tag: 'cm-bubbles-prog', buttonRows: dm.buttonRows });
      await markSent(db, due, new Date(nowMs).toISOString());
      prog = due.length;
    }
  }
  const lives = pendingLive(rows, nowMs);
  for (const r of lives) {
    const dm = formatLiveDm(r);
    await notifyOwner({ title: dm.title, lines: dm.lines, tag: 'cm-bubbles-live', buttonRows: dm.buttonRows });
    await markSent(db, [r], new Date(nowMs).toISOString());
    live++;
  }
  return { prog, live };
}

export async function handleBubbleCallback(db: Db, cq: { id: string; data?: string; from?: { id?: number; username?: string }; message?: { chat?: { id?: number }; message_id?: number } }): Promise<boolean> {
  const m = /^cmb:(ok|no):(\d+)$/.exec(String(cq?.data ?? ''));
  if (!m) return false;
  const tg = async (method: string, payload: Record<string, unknown>) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return null;
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(6000), body: JSON.stringify(payload) });
      return (await r.json().catch(() => null)) as { ok?: boolean } | null;
    } catch { return null; }
  };
  const answer = (text: string) => tg('answerCallbackQuery', { callback_query_id: cq.id, text: text.slice(0, 190) });
  if (!(await adminTgIds()).includes(Number(cq.from?.id))) { await answer('Réservé aux admins.'); return true; }
  if (!(await bubblesEnabled(db))) { await answer('Bulles coupées (CHANNEL_BUBBLES / cm_bubbles).'); return true; }
  const { data } = await db.from('channel_posts').select('id,day,slot,kind,text,status,scheduled_at,report').eq('id', Number(m[2])).limit(1);
  const r = (data ?? [])[0] as BubbleRow | undefined;
  if (!r || !isBubbleRow(r)) { await answer('Introuvable.'); return true; }
  const by = cq.from?.username ? `@${cq.from.username}` : String(cq.from?.id ?? 'admin');
  const rep = { ...asObj(r.report), decided_by: by, decided_at: new Date().toISOString() };
  if (m[1] === 'ok') {
    if (r.status !== 'info') { await answer(r.status === 'approved' ? 'Le remplacement est déjà prévu.' : 'Déjà traité.'); return true; }
    await db.from('channel_posts').update({ report: { ...rep, faite: true } }).eq('id', r.id).eq('status', 'info');
    await answer('Noté, bulle faite. Rien d\'autre ne part.');
    return true;
  }
  // Pas cette fois : le texte de remplacement part au créneau, comme un post validé (kind reste video).
  if (r.status === 'published' || r.status === 'publishing') { await answer('Déjà parti.'); return true; }
  if (r.status === 'approved' && (r.text || '').trim()) { await answer('Le remplacement est déjà prévu, il partira à l\'heure.'); return true; }
  const fallback = String((rep as BubbleReport).fallback ?? r.text ?? '').trim();
  if (!fallback) { await answer('Pas de texte de remplacement sur cette bulle.'); return true; }
  await db.from('channel_posts').update({
    status: 'approved', text: fallback, button_text: null, button_url: null, photo_url: null,
    decided_by: by, decided_at: new Date().toISOString(),
    report: { ...rep, faite: false, fallback_approved: true },
  }).eq('id', r.id).in('status', ['info', 'approved']);
  await answer('Le texte de remplacement partira à l\'heure du créneau.');
  return true;
}

