// DEMANDES DE BULLES VIDÉO À MATHIEU.
// 19/11/2026 : un DM à 11:30, une relance à 13:30, un abandon à 15:00, et des bulles « live » à part.
// 24/11/2026, Mathieu : « Oui, Dev prépare la PR pour un seul message de bulles à 11:30, bien expliqué,
// sans bulles live ni abandon à 15:00 ».
//
//   · À 11:30 Dubaï, tous les jours, UN message (découpé seulement s'il dépasse 4096 caractères) avec
//     les 3 ou 4 bulles du jour : sujet, pourquoi aujourd'hui, heure de Dubaï, durée, accroche,
//     points à dire, phrase de fin avec @mathieu_algoria. Le texte vient du CM (lib/channel/writer.ts).
//   · Plus de relance à 13:30, plus d'abandon à 15:00, plus de DM « live » 10 min avant.
//   · Les anciens boutons (horaire, Faite, Pas cette fois) restent lus : un vocal déjà rangé ou un
//     texte de remplacement déjà approuvé ne sont pas rejoués. Pas de nouveau webhook.
//   · Idempotent : report.prog_sent_at (sent_at reste lu pour l'ancien format).
//   · Kill-switch : CHANNEL_BUBBLES=off (env) ou support_settings cm_bubbles=off.
// Les DM vont seulement aux admins.

import { adminTgIds } from '@/lib/member/notifyOwner';
import { dayContext, writeBubbleScripts, type BubbleScript } from './writer';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type BubbleReport = {
  mode?: 'prog' | 'live';
  theme?: string;
  /** Phrase claire pour Mathieu, en français. */
  subject?: string;
  /** Pourquoi on en parle aujourd'hui, en français. */
  why?: string;
  /** Accroche à dire telle quelle, en anglais. */
  hook?: string;
  /** 2 à 4 phrases à dire, ou une consigne (« Dis où tu es… »). */
  points?: string[];
  /** Phrase de fin à dire, avec @mathieu_algoria. */
  closing?: string;
  duration?: string;
  fallback?: string;
  writer?: string;
  sent_at?: string;
  prog_sent_at?: string;
  nudge_sent_at?: string;
  live_sent_at?: string;
  chosen_at?: string;
  chosen_hm?: string;
  faite?: boolean;
  fallback_approved?: boolean;
  decided_by?: string;
  decided_at?: string;
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
export const SLOT_MIN = '13:00';
export const SLOT_GAP_MIN = 30;
export const SLOT_PREF = ['13:00', '15:30', '18:00'] as const;
const SLOT_PREF4 = ['13:00', '16:00', '18:30', '21:00'] as const;
/** Plafond d'un message Telegram. On reste en dessous : le HTML du titre compte dans les 4096. */
export const TELEGRAM_TEXT_MAX = 4096;
const PROG_WINDOW_MS = 90 * 60_000; // cron toutes les 5 min ; 90 min de marge si un passage est raté
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

const progAlreadySent = (rep: BubbleReport) => !!(rep.prog_sent_at || rep.sent_at);

/** Bulles encore à mettre dans le message de 11:30. Un horaire déjà choisi ne les retire pas. */
export function pendingBriefing(rows: BubbleRow[]): BubbleRow[] {
  return rows.filter((r) => {
    if (!isBubbleRow(r) || r.status !== 'info') return false;
    const rep = reportOf(r);
    if (progAlreadySent(rep) || rep.faite || rep.fallback_approved) return false;
    return true;
  });
}

/** À 11:30 seulement. 13:30 et 15:00 ne renvoient rien : pas de relance, pas d'abandon. */
export function briefingDue(now: { day: string; weekday: number; ms: number }, rows: BubbleRow[]): BubbleRow[] {
  if (!inProgWindow(now)) return [];
  return pendingBriefing(rows.filter((r) => String(r.day).slice(0, 10) === now.day))
    .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at) || String(a.slot).localeCompare(String(b.slot)));
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

/** 3 créneaux Dubaï (13:00 / 15:30 / 18:00) ou 4 (13:00 / 16:00 / 18:30 / 21:00). Jamais avant 13:00, 30 min d'écart. */
export function pickBubbleSlots(day: string, occupiedIso: string[], count = 3): string[] {
  const occ = occupiedIso.map((s) => Date.parse(s)).filter(Number.isFinite);
  const seen = new Set<string>();
  const ordered: string[] = [];
  const pref = count >= 4 ? SLOT_PREF4 : SLOT_PREF;
  for (const hm of [...pref, ...slotGrid()]) {
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
const STAGE = /^(dis|montre|filme|commence|regarde|raconte|cite|say|show|film|start|tell|mention)\b/i;
const quoteSay = (s: string) => `"${esc(s.trim().replace(/^["“«]+|["”»]+$/g, ''))}"`;
const formatPoint = (p: string) => (STAGE.test(p.trim()) ? esc(p.trim()) : quoteSay(p));

export function formatBubbleBlock(r: BubbleRow, n: number): string {
  const rep = reportOf(r);
  const when = r.scheduled_at ? dubaiHHMM(r.scheduled_at) : '';
  const duration = (rep.duration ?? '').trim();
  const head = `Bulle ${n} — ${when} Dubaï${duration ? ` — ${duration}` : ''}`;
  const lines = [`<b>${esc(head)}</b>`];
  const subject = (rep.subject ?? r.text ?? '').trim();
  if (subject) lines.push(`<b>Sujet :</b> ${esc(subject)}`);
  if (rep.why?.trim()) lines.push(`<b>Pourquoi aujourd'hui :</b> ${esc(rep.why.trim())}`);
  if (rep.hook?.trim()) lines.push(`<b>Accroche à dire telle quelle :</b> ${quoteSay(rep.hook)}`);
  const points = (rep.points ?? []).map((p) => p.trim()).filter(Boolean);
  if (points.length) {
    lines.push('<b>Points à dire :</b>');
    points.forEach((p, i) => lines.push(`${i + 1}. ${formatPoint(p)}`));
  }
  if (rep.closing?.trim()) lines.push(`<b>Fin :</b> ${quoteSay(rep.closing)}`);
  return lines.join('\n');
}

const BRIEF_INTRO = '<b>🎥 Bulles à enregistrer aujourd\'hui</b>\nEnregistre-les toutes maintenant, dans l\'ordre. Chacune est publiée à l\'heure indiquée (Dubaï).';
const BRIEF_SUITE = '<b>🎥 Bulles à enregistrer aujourd\'hui (suite)</b>\n\n';

/** Découpe sur les limites de bulles. Une bulle plus longue que la limite est coupée entre deux lignes. */
export function packTelegramHtml(blocks: string[], limit: number): string[] {
  const out: string[] = [];
  let cur = '';
  const push = (s: string) => { if (s.trim()) out.push(s); };
  const take = (block: string) => {
    if (block.length <= limit) return [block];
    const pieces: string[] = [];
    let acc = '';
    for (const line of block.split('\n')) {
      const one = line.length > limit ? line.slice(0, limit) : line;
      const next = acc ? `${acc}\n${one}` : one;
      if (acc && next.length > limit) { pieces.push(acc); acc = one; }
      else acc = next;
    }
    if (acc) pieces.push(acc);
    return pieces;
  };
  for (const block of blocks) {
    for (const piece of take(block)) {
      const next = cur ? `${cur}\n\n${piece}` : piece;
      if (cur && next.length > limit) { push(cur); cur = piece; }
      else cur = next;
    }
  }
  if (cur) push(cur);
  return out;
}

/** Un ou plusieurs messages HTML, chacun sous la limite. Le second porte « (suite) ». */
export function formatBriefingMessages(rows: BubbleRow[], limit = TELEGRAM_TEXT_MAX): string[] {
  const sorted = [...rows].sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at) || String(a.slot).localeCompare(String(b.slot)));
  if (!sorted.length) return [];
  const budget = Math.max(400, limit - BRIEF_SUITE.length);
  const packed = packTelegramHtml([BRIEF_INTRO, ...sorted.map((r, i) => formatBubbleBlock(r, i + 1))], budget);
  return packed.map((p, i) => (i === 0 ? p : `${BRIEF_SUITE}${p}`));
}

/** Lignes channel_posts pour les scripts du CM. Jamais mode live. `text` = l'accroche anglaise, pas le sujet français. */
export function bubbleRowsFromScripts(day: string, scripts: BubbleScript[], occupiedIso: string[]) {
  const slots = pickBubbleSlots(day, occupiedIso, scripts.length);
  return scripts.slice(0, slots.length).map((s, i) => ({
    day,
    slot: `bubble${i + 1}`,
    kind: 'video' as const,
    text: s.hook,
    status: 'info' as const,
    scheduled_at: `${day}T${slots[i]}:00+04:00`,
    report: {
      mode: 'prog' as const,
      theme: s.theme,
      subject: s.subject,
      why: s.why,
      duration: s.duration,
      hook: s.hook,
      points: s.points,
      closing: s.closing,
      writer: 'ai' as const,
    },
  }));
}

/** Section du plan de 21:00, à la place de « Idée de bulle » quand des bubble1–4 existent. */
export function renderBubblesPlanSection(rows: Array<{ slot?: string; kind?: string; scheduled_at?: string; report?: unknown; text?: string | null }>): string | null {
  const bubbles = rows.filter(isBubbleRow).sort((a, b) => Date.parse(String(a.scheduled_at)) - Date.parse(String(b.scheduled_at)));
  if (!bubbles.length) return null;
  const lines = ['🎥 <b>Bulles de demain</b>'];
  for (const r of bubbles) {
    const rep = reportOf(r as BubbleRow);
    const when = r.scheduled_at ? dubaiHHMM(r.scheduled_at) : '';
    const theme = rep.theme ? `${esc(rep.theme)} — ` : '';
    lines.push(`${when} Dubaï · ${theme}${esc(rep.subject ?? r.text ?? '')}`);
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

async function deliverBriefing(parts: string[]): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ids = await adminTgIds();
  if (!token || !ids.length || !parts.length) return false;
  let ok = 0;
  await Promise.all(ids.map(async (chat_id) => {
    for (const text of parts) {
      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
          body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        });
        const j = (await r.json().catch(() => null)) as { ok?: boolean } | null;
        if (j?.ok) ok++;
      } catch { /* un admin injoignable ne bloque pas les autres */ }
    }
  }));
  return ok > 0;
}

/** Crée les bulles du jour si le CM n'en a pas encore. N'écrit rien s'il y en a déjà, ni si le modèle refuse. */
export async function ensureDayBubbles(db: Db, day: string, webinar?: string): Promise<{ have: boolean; inserted: number }> {
  if (!(await bubblesEnabled(db))) return { have: false, inserted: 0 };
  const { data: existing } = await db.from('channel_posts').select('id,slot,kind,status,scheduled_at,report').eq('day', day);
  const rows = (existing ?? []) as Array<{ id: number; slot?: string; kind?: string; status?: string; scheduled_at?: string | null; report?: unknown }>;
  if (rows.some((r) => isBubbleRow(r))) return { have: true, inserted: 0 };
  const ctx = await dayContext(db, day).catch(() => null);
  if (!ctx) return { have: false, inserted: 0 };
  if (webinar) ctx.webinar = webinar;
  const scripts = await writeBubbleScripts(ctx);
  if (!scripts?.length) return { have: false, inserted: 0 };
  const built = bubbleRowsFromScripts(day, scripts, occupiedScheduledAt(rows));
  if (!built.length) return { have: false, inserted: 0 };
  const { error } = await db.from('channel_posts').insert(built);
  if (error) {
    if (/duplicate|unique/i.test(String(error.message ?? ''))) return { have: true, inserted: 0 };
    console.error('[cm] bubbles insert:', error.message);
    return { have: false, inserted: 0 };
  }
  return { have: true, inserted: built.length };
}

/** Appelé au début de runDue (cron toutes les 5 min). Un seul envoi groupé, dans la fenêtre de 11:30. */
export async function sendDueBubbleDms(db: Db, nowMs = Date.now()): Promise<{ prog: number; nudge: number; live: number; skipped: number }> {
  const none = { prog: 0, nudge: 0, live: 0, skipped: 0 };
  if (!(await bubblesEnabled(db))) return none;
  const now = dubaiNow(nowMs);
  if (!inProgWindow(now)) return none;
  let { bubbles } = await loadOpenBubbles(db, now.day);
  let today = bubbles.filter((r) => String(r.day).slice(0, 10) === now.day);
  if (!today.some(isBubbleRow)) {
    await ensureDayBubbles(db, now.day).catch((e) => console.error('[cm] bubbles:', (e as Error).message));
    ({ bubbles } = await loadOpenBubbles(db, now.day));
    today = bubbles.filter((r) => String(r.day).slice(0, 10) === now.day);
  }
  const due = briefingDue(now, today);
  if (!due.length) return none;
  const parts = formatBriefingMessages(due);
  if (!(await deliverBriefing(parts))) return none;
  const at = new Date(nowMs).toISOString();
  await patchReport(db, due, (rep) => ({ ...rep, prog_sent_at: at, sent_at: at }));
  return { prog: due.length, nudge: 0, live: 0, skipped: 0 };
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
    await answer(`Noté, prévue à ${atPick.hm} (Dubaï).`);
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
