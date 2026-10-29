// 🚪 L'INTERRUPTEUR DES DEMANDES D'ADHÉSION AU CANAL, DEPUIS LE BOT (29/10/2026). Server-only.
//
// Mathieu : « ajouter Maria […] pour qu'elle puisse activer et désactiver les demandes automatiques du canal, c'est elle
// qui s'occupe des échanges de pub […] un accès restreint, avec seulement cette option ». Plutôt qu'un rôle dans l'admin
// web (une session admin y ouvre tout : membres, dépôts, compta, push, identifiants), Maria pilote CE SEUL interrupteur en
// écrivant au bot, en privé : « autoaccept » (l'état + deux boutons), « autoaccept on », « autoaccept off ».
//
// QUI : les admins (adminTgIds) + les identifiants Telegram NUMÉRIQUES listés dans JOIN_SWITCH_TG_IDS (Vercel). Jamais un
// @pseudo : il se change et se reprend, un identifiant non. Ce droit n'ouvre RIEN d'autre : aucune autre commande du bot,
// aucune route de l'admin ne lit JOIN_SWITCH_TG_IDS.
//
// QUOI : la même écriture que le panneau de l'admin (app/api/member/admin/route.ts, `channelAutojoin`) : support_settings
// 'public_autojoin' = 'on' | 'off', lu par le runner à chaque passage (runner/index.ts). Le VIP garde son interrupteur.
// Chaque bascule faite par quelqu'un d'autre qu'un admin est signalée à Mathieu (notifyOwner).
import { adminTgIds, notifyOwner } from './notifyOwner';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const JOIN_SWITCH_KEY = 'public_autojoin';
export const JOIN_SWITCH_CB = 'joinsw:'; // callback_data des boutons : joinsw:on / joinsw:off / joinsw:get

/** Les identifiants autorisés en plus des admins (JOIN_SWITCH_TG_IDS, séparés par des virgules ou des espaces). */
export function joinSwitchIds(env = process.env.JOIN_SWITCH_TG_IDS): number[] {
  return String(env ?? '').split(/[\s,]+/).map((s) => Number(s)).filter((n) => Number.isSafeInteger(n) && n > 0);
}

/** Peut-il basculer l'interrupteur ? (admin, ou listé dans JOIN_SWITCH_TG_IDS) */
export async function canToggleJoins(tgId: number): Promise<{ ok: boolean; admin: boolean }> {
  if (!Number.isSafeInteger(tgId) || tgId <= 0) return { ok: false, admin: false };
  if ((await adminTgIds()).includes(tgId)) return { ok: true, admin: true };
  return { ok: joinSwitchIds().includes(tgId), admin: false };
}

/** « autoaccept », « /autoaccept on », « autoaccept off », « autoaccept status » → l'action, sinon null. */
export function parseJoinSwitch(text: string): 'get' | 'on' | 'off' | null {
  const m = /^\/?auto-?accept(?:@\w+)?(?:\s+(on|off|status|state|pause|resume|stop|start))?\s*$/i.exec(String(text ?? '').trim());
  if (!m) return null;
  const a = (m[1] ?? '').toLowerCase();
  if (a === 'on' || a === 'resume' || a === 'start') return 'on';
  if (a === 'off' || a === 'pause' || a === 'stop') return 'off';
  return 'get';
}

export type JoinSwitchState = { on: boolean; changedAt: string | null; changedBy: string | null; waiting: number };

/** Lit (et, pour 'on' / 'off', écrit) l'interrupteur. Même clé, mêmes valeurs que le panneau de l'admin. */
export async function joinSwitch(db: Db, action: 'get' | 'on' | 'off', by: string): Promise<JoinSwitchState> {
  if (action !== 'get') {
    const { error } = await db.from('support_settings').upsert({ key: JOIN_SWITCH_KEY, value: action, updated_at: new Date().toISOString(), updated_by: by }, { onConflict: 'key' });
    if (error) throw new Error(error.message);
  }
  const { data } = await db.from('support_settings').select('value,updated_at,updated_by').eq('key', JOIN_SWITCH_KEY).limit(1);
  const row = (data?.[0] ?? null) as { value?: string; updated_at?: string; updated_by?: string } | null;
  const on = String(row?.value ?? 'on').trim().toLowerCase() !== 'off';
  // demandes en attente du canal public (le VIP n'est pas compté), depuis la coupure ou sur 7 jours
  const since = !on && row?.updated_at ? row.updated_at : new Date(Date.now() - 7 * 86_400_000).toISOString();
  const vip = Number(process.env.TELEGRAM_VIP_CHAT ?? '');
  let q = db.from('telegram_joins').select('id', { count: 'exact', head: true }).gte('joined_at', since).eq('status', 'waiting').is('approved_at', null).not('chat_id', 'is', null);
  if (Number.isFinite(vip) && vip !== 0) q = q.neq('chat_id', vip);
  const { count } = await q;
  return { on, changedAt: row?.updated_at ?? null, changedBy: row?.updated_by ?? null, waiting: Number(count ?? 0) };
}

const dubai = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

/** Le message du bot : l'état, et le bouton qui fait l'inverse. */
export function joinSwitchMessage(s: JoinSwitchState, changed?: 'on' | 'off'): { text: string; reply_markup: Record<string, unknown> } {
  const head = changed === 'on' ? '▶ Auto-accept is back ON.' : changed === 'off' ? '⏸ Auto-accept is now OFF.' : s.on ? '🟢 Auto-accept is ON.' : '⏸ Auto-accept is OFF.';
  const body = s.on
    ? 'New join requests to the channel are accepted automatically (within ~1 min).'
    : `New join requests stay pending in Telegram. Waiting now: ${s.waiting}.`;
  const last = s.changedAt ? `\nLast change: ${dubai(s.changedAt)} (Dubai)${s.changedBy ? ` by ${s.changedBy}` : ''}.` : '';
  return {
    text: `🚪 Channel join requests\n\n${head}\n${body}${last}`,
    reply_markup: { inline_keyboard: [[s.on ? { text: '⏸ STOP AUTO-ACCEPT', callback_data: `${JOIN_SWITCH_CB}off` } : { text: '▶ RESUME AUTO-ACCEPT', callback_data: `${JOIN_SWITCH_CB}on` }, { text: '↻', callback_data: `${JOIN_SWITCH_CB}get` }]] },
  };
}

/** Prévient Mathieu quand quelqu'un qui n'est pas admin bascule l'interrupteur. */
export async function noteJoinSwitch(by: string, s: JoinSwitchState, action: 'on' | 'off'): Promise<void> {
  await notifyOwner({
    title: action === 'off' ? '⏸ Auto-accept du canal COUPÉ' : '▶ Auto-accept du canal RALLUMÉ',
    lines: [`Par ${by}, depuis le bot.`, action === 'on' ? `${s.waiting} demande(s) en attente seront acceptées dans la minute.` : 'Les nouvelles demandes restent en attente dans Telegram.'],
    tag: 'join-switch',
  }).catch(() => null);
}
