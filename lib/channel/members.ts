// 📊 MESURE DU CANAL PUBLIC (10/11/2026, refonte du CM : Mathieu veut voir si le nouveau ton retient les gens).
//
// Chaque jour, pour le canal source, le miroir UK, le canal IT et les miroirs supplémentaires :
//   · le nombre de membres (Bot API getChatMemberCount, le bot est admin de ces canaux puisqu'il y publie) ;
//   · les entrées et les départs du jour, comptés à partir des updates chat_member que le webhook reçoit DÉJÀ
//     (chat_member est dans TG_ALLOWED_UPDATES : rien à ré-enregistrer, allowed_updates inchangé).
// La photo du jour est prise par la cron du CM (toutes les 5 min) une fois par jour, à partir de 23:30 (Paris).
// Tables : migration 0043 (additive). Tant qu'elle n'est pas appliquée, tout échoue en silence (rien ne casse).
import { extraMirrors } from './mirrors';
import { tradingDayOf, tradingDayStartMs, tradingTimeMs } from '@/lib/display/tradingDay';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const IN = ['member', 'administrator', 'creator', 'restricted'];
const OUT = ['left', 'kicked'];

/** Les canaux mesurés : { chat_id, libellé }. */
export function trackedChannels(env: Record<string, string | undefined> = process.env): Array<{ chat: string; label: string }> {
  const out: Array<{ chat: string; label: string }> = [];
  const add = (chat: string | undefined, label: string) => { const c = String(chat ?? '').trim(); if (c && !out.some((x) => x.chat === c)) out.push({ chat: c, label }); };
  add(env.TELEGRAM_CHANNEL_EN, 'source');
  add(env.TELEGRAM_CHANNEL_MIRROR, 'mirror UK');
  add(env.TELEGRAM_CHANNEL_IT, 'canale IT');
  for (const m of extraMirrors(env as NodeJS.ProcessEnv)) add(m.chat, m.label);
  return out;
}

/** Entrée (+1), départ (−1) ou rien (0) pour un update chat_member. */
export function memberDelta(oldStatus?: string | null, newStatus?: string | null): 1 | -1 | 0 {
  const was = IN.includes(String(oldStatus));
  const is = IN.includes(String(newStatus));
  if (!was && is) return 1;
  if (was && OUT.includes(String(newStatus))) return -1;
  return 0;
}

/** Garde une entrée ou une sortie d'un canal mesuré (appelé par le webhook sur chaque chat_member). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function recordMemberEvent(db: Db, cm: any): Promise<void> {
  const chat = String(cm?.chat?.id ?? '');
  if (!chat || !trackedChannels().some((c) => c.chat === chat)) return;
  const oldS = cm?.old_chat_member?.status ?? null, newS = cm?.new_chat_member?.status ?? null;
  if (!memberDelta(oldS, newS)) return;
  await db.from('channel_member_events').insert({
    chat_id: Number(chat), user_id: Number(cm?.new_chat_member?.user?.id) || null, old_status: oldS, new_status: newS,
    invite_name: cm?.invite_link?.name ?? null, at: cm?.date ? new Date(Number(cm.date) * 1000).toISOString() : new Date().toISOString(),
  });
}

/** Compte les entrées et départs d'un jour à partir des événements. */
export function countDay(events: Array<{ old_status: string | null; new_status: string | null }>): { joins: number; leaves: number } {
  let joins = 0, leaves = 0;
  for (const e of events) { const d = memberDelta(e.old_status, e.new_status); if (d > 0) joins++; else if (d < 0) leaves++; }
  return { joins, leaves };
}

export const SNAPSHOT_AT = '23:30';

/** La photo du jour (une fois par jour et par canal, après SNAPSHOT_AT, Paris). Renvoie le nombre de canaux enregistrés. */
export async function snapshotMembersIfDue(db: Db, now = Date.now()): Promise<number> {
  const day = tradingDayOf(now);
  if (now < tradingTimeMs(day, SNAPSHOT_AT)) return 0;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return 0;
  const { data: done } = await db.from('channel_member_stats').select('chat_id').eq('day', day);
  const have = new Set(((done ?? []) as Array<{ chat_id: number }>).map((r) => String(r.chat_id)));
  let n = 0;
  for (const c of trackedChannels()) {
    if (have.has(c.chat)) continue;
    const r = await fetch(`https://api.telegram.org/bot${token}/getChatMemberCount`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(6000), body: JSON.stringify({ chat_id: c.chat }) })
      .then((x) => x.json()).catch(() => null) as { ok?: boolean; result?: number } | null;
    const { data: ev } = await db.from('channel_member_events').select('old_status,new_status').eq('chat_id', Number(c.chat))
      .gte('at', new Date(tradingDayStartMs(day)).toISOString()).lte('at', new Date(now).toISOString()).limit(10000);
    const { joins, leaves } = countDay((ev ?? []) as Array<{ old_status: string | null; new_status: string | null }>);
    const { error } = await db.from('channel_member_stats').insert({ day, chat_id: Number(c.chat), label: c.label, members: r?.ok ? Number(r.result) : null, joins, leaves });
    if (!error) n++;
  }
  return n;
}
