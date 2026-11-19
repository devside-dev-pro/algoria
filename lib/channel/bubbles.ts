// DEMANDES DE BULLES VIDÉO À MATHIEU (calendrier 18–24/11, partie D, décision du 17/11/2026 ;
// horaires du 19/11/2026 : Mathieu, « OK pour la nouvelle organisation des bulles et de l'info du matin, réglages et PR »).
//
// Les lignes (slot bubble1…bubble4, kind=video, status=info) sont insérées par le script
// scripts/insert-bubbles-18-24.ts — livré, pas exécuté tout seul.
//
//   · PROG : un seul DM « 🎥 Bulles à programmer aujourd'hui » à 11:30 Dubaï tous les jours, week-end compris.
//   · Dans ce DM, chaque bulle du jour a 3 boutons d'horaire (≥ 13:00 Dubaï, 30 min d'écart avec les posts CM
//     et les autres bulles). L'horaire choisi est écrit dans scheduled_at.
//   · Relance unique à 13:30 si une bulle n'a toujours pas de réponse (ni horaire, ni Faite, ni Pas cette fois).
//   · Après 15:00 (fin de la fenêtre de relance) : status=skipped, raison claire, pas de texte de remplacement.
//   · LIVE : un DM 10 minutes avant l'horaire choisi (« C'est le moment de faire une bulle… »).
//   · Boutons « ✅ Faite » (rien d'autre ne part) et « ⏭ Pas cette fois » (le texte de remplacement
//     passe en approved et part au créneau, kind reste video pour ne pas bousculer les numéros du plan CM).
//   · Idempotent : report.prog_sent_at / nudge_sent_at / live_sent_at (sent_at reste lu pour l'ancien format).
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
  prog_sent_at?: string;
  nudge_sent_at?: string;
  live_sent_at?: string;
  chosen_at?: string;
  chosen_hm?: string;
  faite?: boolean;
  fallback_approved?: boolean;
  decided_by?: string;
  reason?: string;
  skipped_at?: string;
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
export const PROG_AT = '11:30'; // tous les jours, week-end compris
export const NUDGE_AT = '13:30';
export const SKIP_AT = '15:00'; // fin de la fenêtre de relance (13:30 + 90 min)
export const SLOT_MIN = '13:00';
export const SLOT_GAP_MIN = 30;
export const SLOT_PREF = ['13:00', '15:30', '18:00'] as const;
export const SKIP_REASON = 'sans réponse après la relance de 13:30';
const PROG_WINDOW_MS = 90 * 60_000; // cron toutes les 5 min ; 90 min de marge si un passage est raté
const NUDGE_WINDOW_MS = 90 * 60_000;
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
/** Toujours 11:30, y compris le week-end (l'argument est conservé pour les appels existants). */
export const progAtFor = (_weekday?: number) => PROG_AT;

const atHm = (day: string, hm: string) => Date.parse(`${day}T${hm}:00+04:00`);

/** Premier passage du cron dans la fenêtre [11:30, 13:00) Dubaï, tous les jours. */
export function inProgWindow(now: { day: string; weekday: number; ms: number }): boolean {
  const start = atHm(now.day, PROG_AT);
  return now.ms >= start && now.ms < start + PROG_WINDOW_MS;
}

/** Premier passage dans [13:30, 15:00) Dubaï. */
export function inNudgeWindow(now: { day: string; ms: number }): boolean {
  const start = atHm(now.day, NUDGE_AT);
  return now.ms >= start && now.ms < start + NUDGE_WINDOW_MS;
}

/** À partir de 15:00 Dubaï le jour J, ou le lendemain si la fenêtre a été manquée. */
export function inSkipWindow(now: { day: string; ms: number }, rowDay: string): boolean {
  const day = String(rowDay).slice(0, 10);
  if (day < now.day) return true;
  if (day > now.day) return false;
  return now.ms >= atHm(now.day, SKIP_AT);
}

/** Premier passage dans [scheduled_at − 10 min, scheduled_at). */
export function inLiveWindow(scheduledAt: string, nowMs: number): boolean {
  const at = Date.parse(scheduledAt);
  return nowMs >= at - LIVE_LEAD_MS && nowMs < at;
}

export function isUnanswered(r: BubbleRow): boolean {
  const rep = reportOf(r);
  return r.status === 'info' && !rep.faite && !rep.chosen_at && !rep.fallback_approved;
}

const progAlreadySent = (rep: BubbleReport) => !!(rep.prog_sent_at || rep.sent_at);

export function pendingProg(rows: BubbleRow[]): BubbleRow[] {
  return rows.filter((r) => isUnanswered(r) && !progAlreadySent(reportOf(r)));
}

export function pendingNudge(rows: BubbleRow[]): BubbleRow[] {
  return rows.filter((r) => isUnanswered(r) && !reportOf(r).nudge_sent_at);
}

export function pendingSkip(rows: BubbleRow[], now: { day: string; ms: number }): BubbleRow[] {
  return rows.filter((r) => isUnanswered(r) && inSkipWindow(now, r.day));
}

/** Rappel −10 min : seulement après un horaire choisi (le mécanisme inLiveWindow ne change pas). */
export function pendingLive(rows: BubbleRow[], nowMs: number): BubbleRow[] {
  return rows.filter((r) => {
    const rep = reportOf(r);
    return r.status === 'info' && !!rep.chosen_at && !rep.faite && !rep.live_sent_at && inLiveWindow(r.scheduled_at, nowMs);
  });
}

export function timesConflict(aMs: number, bMs: number, gapMin = SLOT_GAP_MIN): boolean {
  return Number.isFinite(aMs) && Number.isFinite(bMs) && Math.abs(aMs - bMs) < gapMin * 60_000;
}

export function slotGrid(minHm = SLOT_MIN, maxHm = '22:00', stepMin = 30): string[] {
  const toMin = (hm: string) => {
    const [h, m] = hm.split(':').map(Number);
    return h * 60 + m;
  };
  const out: string[] = [];
  for (let t = toMin(minHm); t <= toMin(maxHm); t += stepMin) {
    out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  }
  return out;
}

/** 3 créneaux Dubaï, préférés 13:00 / 15:30 / 18:00, jamais avant 13:00, 30 min d'écart avec les horaires occupés. */
export function pickBubbleSlots(day: string, occupiedIso: string[], count = 3): string[] {
  const occ = occupiedIso.map((s) => Date.parse(s)).filter(Number.isFinite);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const hm of [...SLOT_PREF, ...slotGrid()]) {
    if (hm < SLOT_MIN || seen.has(hm)) continue;
    seen.add(hm);
    ordered.push(hm);
  }
  const picked: string[] = [];
  for (const hm of ordered) {
    const ms = atHm(day, hm);
    if (occ.some((o) => timesConflict(o, ms))) continue;
    if (picked.some((p) => timesConflict(atHm(day, p), ms))) continue;
    picked.push(hm);
    if (picked.length === count) break;
  }
  return picked;
}

export function occupiedScheduledAt(posts: Array<{ id: number; scheduled_at?: string | null; status?: string }>, exceptId?: number): string[] {
  return posts
    .filter((p) => p.id !== exceptId && ['approved', 'draft', 'info', 'publishing'].includes(String(p.status ?? '')) && p.scheduled_at)
    .map((p) => String(p.scheduled_at));
}

export type TimeChoiceOk = { ok: true; scheduled_at: string; report: BubbleReport };
export type TimeChoiceNo = { ok: false; reason: string };

export function applyTimeChoice(r: BubbleRow, hm: string, occupiedIso: string[], by: string, at: string): TimeChoiceOk | TimeChoiceNo {
  if (!/^\d{2}:\d{2}$/.test(hm)) return { ok: false, reason: 'Horaire illisible.' };
  if (hm < SLOT_MIN) return { ok: false, reason: `Pas de bulle avant ${SLOT_MIN} (Dubaï).` };
  if (r.status !== 'info') return { ok: false, reason: r.status === 'skipped' ? 'Déjà annulée.' : 'Déjà traité.' };
  const rep = reportOf(r);
  if (rep.faite) return { ok: false, reason: 'Déjà notée comme faite.' };
  const day = String(r.day).slice(0, 10);
  const scheduled_at = `${day}T${hm}:00+04:00`;
  const ms = Date.parse(scheduled_at);
  if (!Number.isFinite(ms)) return { ok: false, reason: 'Horaire illisible.' };
  if (occupiedIso.map((s) => Date.parse(s)).some((o) => timesConflict(o, ms))) {
    return { ok: false, reason: "Ce créneau est trop près d'un autre post. Choisis-en un autre." };
  }
  if (rep.chosen_hm === hm) return { ok: false, reason: `Déjà noté à ${hm}.` };
  const { live_sent_at: _drop, ...rest } = rep;
  return {
    ok: true,
    scheduled_at,
    report: { ...rest, chosen_at: at, chosen_hm: hm, decided_by: by, decided_at: at } as BubbleReport,
  };
}

export const atCallbackData = (id: number, hm: string) => `cmb:at:${id}:${hm.replace(':', '')}`;
export const parseAtCallback = (data: string): { id: number; hm: string } | null => {
  const m = /^cmb:at:(\d+):(\d{4})$/.exec(data);
  if (!m) return null;
  return { id: Number(m[1]), hm: `${m[2].slice(0, 2)}:${m[2].slice(2)}` };
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dubaiHHMM = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });

const pointsLine = (rep: BubbleReport) => (rep.points ?? []).map((p, i) => `${i + 1}) ${p}`).join(' ');

export function formatProgDm(rows: BubbleRow[], occupiedIso: string[] = []): { title: string; lines: string[]; buttonRows: Array<Array<{ text: string; data: string }>> } {
  const lines: string[] = [];
  const buttonRows: Array<Array<{ text: string; data: string }>> = [];
  const reserved: string[] = [...occupiedIso];
  for (const r of rows) {
    const rep = reportOf(r);
    const day = String(r.day).slice(0, 10);
    const slots = pickBubbleSlots(day, reserved.filter((iso) => {
      // ne pas bloquer un créneau avec l'horaire actuel de CETTE bulle (il va être remplacé)
      return iso !== r.scheduled_at;
    }));
    for (const hm of slots) reserved.push(`${day}T${hm}:00+04:00`);
    lines.push('', `PROG · ${rep.duration ?? ''}`.trim(), rep.subject ?? r.text ?? '', pointsLine(rep));
    if (slots.length) {
      buttonRows.push(slots.map((hm) => ({ text: hm, data: atCallbackData(r.id, hm) })));
    }
    buttonRows.push([
      { text: '✅ Faite', data: `cmb:ok:${r.id}` },
      { text: '⏭ Pas cette fois', data: `cmb:no:${r.id}` },
    ]);
  }
  return { title: '🎥 Bulles à programmer aujourd\'hui', lines: lines.filter((l, i) => !(i === 0 && l === '')), buttonRows };
}

export function formatNudgeDm(rows: BubbleRow[], occupiedIso: string[] = []): { title: string; lines: string[]; buttonRows: Array<Array<{ text: string; data: string }>> } {
  const dm = formatProgDm(rows, occupiedIso);
  return { ...dm, title: '🎥 Relance : bulles du jour sans réponse' };
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

async function patchReport(db: Db, rows: BubbleRow[], patch: (rep: BubbleReport) => BubbleReport): Promise<void> {
  for (const r of rows) {
    const report = patch(reportOf(r));
    await db.from('channel_posts').update({ report }).eq('id', r.id);
    r.report = report;
  }
}

async function loadOpenBubbles(db: Db, day: string): Promise<{ bubbles: BubbleRow[]; posts: BubbleRow[] }> {
  const prev = new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const { data } = await db.from('channel_posts').select('id,day,slot,kind,text,status,scheduled_at,report').gte('day', prev).lte('day', day).order('scheduled_at', { ascending: true });
  const posts = (data ?? []) as BubbleRow[];
  return { bubbles: posts.filter(isBubbleRow), posts };
}

/** Appelé au début de runDue (cron toutes les 5 min, suffisant pour un LIVE à −10 min). */
export async function sendDueBubbleDms(db: Db, nowMs = Date.now()): Promise<{ prog: number; nudge: number; live: number; skipped: number }> {
  if (!(await bubblesEnabled(db))) return { prog: 0, nudge: 0, live: 0, skipped: 0 };
  const now = dubaiNow(nowMs);
  const at = new Date(nowMs).toISOString();
  const { bubbles, posts } = await loadOpenBubbles(db, now.day);
  const todayPosts = posts.filter((p) => String(p.day).slice(0, 10) === now.day);
  const occupied = occupiedScheduledAt(todayPosts);
  let prog = 0, nudge = 0, live = 0, skipped = 0;
  if (inProgWindow(now)) {
    const due = pendingProg(bubbles.filter((r) => String(r.day).slice(0, 10) === now.day));
    if (due.length) {
      const dm = formatProgDm(due, occupied);
      await notifyOwner({ title: dm.title, lines: dm.lines, tag: 'cm-bubbles-prog', buttonRows: dm.buttonRows });
      await patchReport(db, due, (rep) => ({ ...rep, prog_sent_at: at, sent_at: at }));
      prog = due.length;
    }
  }
  if (inNudgeWindow(now)) {
    const due = pendingNudge(bubbles.filter((r) => String(r.day).slice(0, 10) === now.day));
    if (due.length) {
      const dm = formatNudgeDm(due, occupied);
      await notifyOwner({ title: dm.title, lines: dm.lines, tag: 'cm-bubbles-nudge', buttonRows: dm.buttonRows });
      await patchReport(db, due, (rep) => ({ ...rep, nudge_sent_at: at }));
      nudge = due.length;
    }
  }
  const toSkip = pendingSkip(bubbles, now);
  for (const r of toSkip) {
    const report = { ...asObj(r.report), reason: SKIP_REASON, skipped_at: at };
    const { data } = await db.from('channel_posts').update({ status: 'skipped', report }).eq('id', r.id).eq('status', 'info').select('id');
    if (data?.length) {
      r.status = 'skipped';
      r.report = report;
      skipped++;
    }
  }
  const lives = pendingLive(bubbles, nowMs);
  for (const r of lives) {
    const dm = formatLiveDm(r);
    await notifyOwner({ title: dm.title, lines: dm.lines, tag: 'cm-bubbles-live', buttonRows: dm.buttonRows });
    await patchReport(db, [r], (rep) => ({ ...rep, live_sent_at: at }));
    live++;
  }
  return { prog, nudge, live, skipped };
}

export async function handleBubbleCallback(db: Db, cq: { id: string; data?: string; from?: { id?: number; username?: string }; message?: { chat?: { id?: number }; message_id?: number } }): Promise<boolean> {
  const raw = String(cq?.data ?? '');
  const atPick = parseAtCallback(raw);
  const m = atPick ? null : /^cmb:(ok|no):(\d+)$/.exec(raw);
  if (!atPick && !m) return false;
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
  const id = atPick ? atPick.id : Number(m![2]);
  const { data } = await db.from('channel_posts').select('id,day,slot,kind,text,status,scheduled_at,report').eq('id', id).limit(1);
  const r = (data ?? [])[0] as BubbleRow | undefined;
  if (!r || !isBubbleRow(r)) { await answer('Introuvable.'); return true; }
  const by = cq.from?.username ? `@${cq.from.username}` : String(cq.from?.id ?? 'admin');
  if (atPick) {
    const day = String(r.day).slice(0, 10);
    const { data: dayRows } = await db.from('channel_posts').select('id,scheduled_at,status').eq('day', day);
    const occupied = occupiedScheduledAt((dayRows ?? []) as Array<{ id: number; scheduled_at?: string | null; status?: string }>, r.id);
    const choice = applyTimeChoice(r, atPick.hm, occupied, by, new Date().toISOString());
    if (!choice.ok) { await answer(choice.reason); return true; }
    await db.from('channel_posts').update({ scheduled_at: choice.scheduled_at, report: choice.report }).eq('id', r.id).eq('status', 'info');
    await answer(`Noté, prévue à ${atPick.hm} (Dubaï). Rappel 10 min avant.`);
    return true;
  }
  const rep = { ...asObj(r.report), decided_by: by, decided_at: new Date().toISOString() };
  if (m![1] === 'ok') {
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
