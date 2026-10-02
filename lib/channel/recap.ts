// 📣 RÉCAP DU SOIR DANS LE CANAL (02/10/2026) — décisions Mathieu :
//   · tous les soirs de semaine, un récap de la journée à 21h30 dans le canal source ;
//   · MODE VALIDATION : à 21h15 le bot envoie le brouillon aux admins avec ✅ PUBLIER / ❌ Pas ce soir, rien
//     ne part sans un clic (lib/channel/publish.ts publie alors source + miroir UK + canal italien traduit) ;
//   · JOURNÉE ROUGE = option A : pas de chiffres ce soir-là, le post renvoie au track record complet de l'app ;
//   · montants à 0.01 lot ET à 0.10 lot (lib/display/scale.ts : conversion PAR TRADE, puis somme).
// Mêmes trades que l'onglet History de l'app (stratégie live, sans les micro-scalps de démonstration, sans
// NAS100, sans les stratégies en maintenance) : le récap ne peut pas annoncer un chiffre que l'app contredit.
// Passé réel uniquement, jamais de projection ; la phrase de risque accompagne chaque montant.
import { isShowTrade } from '@/lib/cockpit/showTrades';
import { inMaintenance, LIVE_STRATEGY } from '@/lib/member/maintenance';
import { atRef } from '@/lib/display/scale';
import { adminTgIds, notifyOwner } from '@/lib/member/notifyOwner';
import { publishToChannels, sourceChannel } from '@/lib/channel/publish';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
type Trade = { ticket: string; symbol: string; pnl: number; lot: number | null; strategy: number | null; closed_at: string };
export type RecapKind = 'win' | 'record' | 'week' | 'quiet' | 'red';
export type Recap = { day: string; kind: RecapKind; text: string; trades: number; net01: number; net10: number };

const TZ = 'Europe/Paris';
/** 'YYYY-MM-DD' du jour à Paris. */
export const parisDay = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
export const parisHour = (d = new Date()) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(d));
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 dimanche … 6 samedi (midi UTC = même jour à Paris)
const label = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
const shortDate = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** +$14.80 à 0.01 ; +$148 à 0.10 (les centimes n'aident plus à lire au-delà de 100 $). */
const usd = (v: number) => `${v >= 0 ? '+' : '−'}$${Math.abs(v) >= 100 ? Math.round(Math.abs(v)).toLocaleString('en-US') : Math.abs(v).toFixed(2)}`;
const amounts = (net10: number) => `✅ ${usd(net10 / 10)} at 0.01 lot · ${usd(net10)} at 0.10 lot`;
const RISK = "Trading involves risk. Past results don't guarantee future results.";
const APP = '👉 app.algoria.tech';

async function liveTrades(db: Db, sinceIso: string): Promise<Trade[]> {
  const [tq, sq] = await Promise.all([
    db.from('trades').select('ticket,symbol,pnl,lot,strategy,closed_at').not('closed_at', 'is', null).not('pnl', 'is', null).gte('closed_at', sinceIso).order('closed_at', { ascending: true }).limit(5000),
    db.from('signals').select('ticket,rationale').order('created_at', { ascending: false }).limit(400),
  ]);
  if (tq.error) throw new Error(tq.error.message);
  const rafale = new Set(((sq.data ?? []) as { ticket: string; rationale: unknown }[])
    .filter((x) => JSON.stringify(x.rationale ?? '').includes('RAFALE') || JSON.stringify(x.rationale ?? '').includes('ACTION mode')).map((x) => String(x.ticket)));
  return ((tq.data ?? []) as Trade[]).filter((t) =>
    !isShowTrade(t, rafale) && String(t.symbol) !== 'NAS100' && !inMaintenance(Number(t.strategy ?? 2)) && Number(t.strategy ?? 2) === LIVE_STRATEGY);
}

/** Membres passés en copie aujourd'hui (connexion STH validée) : numéros de membre seulement, jamais de nom. */
async function wentLiveToday(db: Db, day: string): Promise<number[]> {
  const { data } = await db.from('member_actions').select('member_no,created_at').eq('kind', 'connect').eq('status', 'done')
    .gte('created_at', new Date(Date.parse(`${day}T00:00:00Z`) - 3 * 3_600_000).toISOString()).limit(50);
  return [...new Set(((data ?? []) as { member_no: number | null; created_at: string }[])
    .filter((r) => r.member_no != null && parisDay(r.created_at) === day).map((r) => Number(r.member_no)))];
}

/** Construit le récap d'un jour (Paris). null le week-end : l'or ne cote pas, rien à raconter. */
export async function buildRecap(db: Db, day = parisDay(new Date())): Promise<Recap | null> {
  const wd = weekday(day);
  if (wd === 0 || wd === 6) return null;
  const monthStart = `${day.slice(0, 8)}01`;
  const monday = addDays(day, -(wd - 1));
  const since = new Date(Date.parse(`${monthStart < monday ? monthStart : monday}T00:00:00Z`) - 3 * 3_600_000).toISOString();
  const all = await liveTrades(db, since);
  const byDay = new Map<string, number>();
  for (const t of all) { const d = parisDay(t.closed_at); byDay.set(d, (byDay.get(d) ?? 0) + atRef(t.pnl, t.lot)); }
  const today = all.filter((t) => parisDay(t.closed_at) === day);
  const net10 = today.reduce((s, t) => s + atRef(t.pnl, t.lot), 0);
  const wins = today.filter((t) => Number(t.pnl) > 0).length;
  const live = await wentLiveToday(db, day);
  const liveLine = live.length ? `\n\n⚡ ${live.slice(0, 3).map((n) => `Member #${n}`).join(', ')} went LIVE today. Welcome to the copy. 🚀` : '';
  const base = { day, trades: today.length, net01: net10 / 10, net10 };

  // VENDREDI : le récap de la semaine, s'il est vert (il inclut la journée, rouge ou non : c'est un total honnête)
  if (wd === 5) {
    const week = all.filter((t) => { const d = parisDay(t.closed_at); return d >= monday && d <= day; });
    const wNet = week.reduce((s, t) => s + atRef(t.pnl, t.lot), 0);
    if (week.length && wNet > 0) {
      return { ...base, kind: 'week', text: [
        `🔵💙 WEEK RECAP · ${shortDate(monday)} to ${shortDate(day)}`,
        `🤖 ${week.length} trade${week.length > 1 ? 's' : ''} closed on gold this week\n${amounts(wNet)}\n🔁 Copied automatically on every member account`,
        `Have a great weekend, Algoria family. The AI is back Monday. 💙${liveLine}`,
        `${APP}`,
        RISK,
      ].join('\n\n') };
    }
  }
  if (!today.length) {
    return { ...base, kind: 'quiet', text: [
      `🔵💙 DAY RECAP · ${label(day)}`,
      'No clean setup on gold today, so no trade. 🧘',
      `That's not a bug, that's the plan: Algoria never forces a trade. Quiet days are part of the strategy.${liveLine}`,
      `📊 Every trade it ever took is in the app, trade by trade:\n${APP}`,
    ].join('\n\n') };
  }
  if (net10 < 0) {
    // OPTION A (Mathieu, 02/10) : pas de chiffres un jour rouge — mais pas de mensonge non plus : on dit que tout
    // est dans l'app, jours rouges compris, et on n'annonce aucun gain.
    return { ...base, kind: 'red', text: [
      `🔵💙 DAY RECAP · ${label(day)}`,
      `🤖 Algoria AI managed today's gold session, ${today.length} trade${today.length > 1 ? 's' : ''}, every one with its stop loss.`,
      `📊 Every trade it takes is in the app, trade by trade, red days included. No filter, no screenshots: the real copied account.${liveLine}`,
      APP,
    ].join('\n\n') };
  }
  // RECORD : meilleure journée du mois, à condition d'avoir au moins 5 autres séances ce mois-ci pour comparer
  const prior = [...byDay.entries()].filter(([d]) => d >= monthStart && d < day).map(([, v]) => v);
  if (prior.length >= 5 && net10 > Math.max(...prior)) {
    const month = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
    return { ...base, kind: 'record', text: [
      '🔵💙 WHAT A DAY 🥇',
      `🤖 ${today.length} trade${today.length > 1 ? 's' : ''}, ${wins} win${wins > 1 ? 's' : ''} on gold\n${amounts(net10)}\n🏆 The best day of ${month} so far`,
      `And the members ? They were at work, at the gym, with their kids. The copy did the job. 📲${liveLine}`,
      APP,
      RISK,
    ].join('\n\n') };
  }
  return { ...base, kind: 'win', text: [
    `🔵💙 DAY RECAP · ${label(day)}`,
    `🤖 Algoria AI closed ${today.length} trade${today.length > 1 ? 's' : ''} on gold today\n${amounts(net10)}`,
    `Every member account copied ${today.length > 1 ? 'them' : 'it'} automatically. Nobody had to touch a thing. 📲${liveLine}`,
    `${APP.replace('👉', '👉 Not copying yet ?')}`,
    RISK,
  ].join('\n\n') };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 21h15 : prépare le brouillon du jour (une seule fois) et l'envoie aux admins avec les boutons. */
export async function draftTonight(db: Db, day = parisDay(new Date())): Promise<{ status: string; recap?: Recap }> {
  const recap = await buildRecap(db, day);
  if (!recap) return { status: 'weekend' };
  // le jour est la clé primaire : un second déclenchement le même soir ne recrée rien et ne renvoie rien
  const { error } = await db.from('channel_recaps').insert({ day, kind: recap.kind, text: recap.text, trades: recap.trades, net10: Math.round(recap.net10 * 100) / 100, status: 'draft' });
  if (error) return { status: /duplicate|unique/i.test(error.message) ? 'already drafted' : `error: ${error.message}` };
  await notifyOwner({
    title: '📣 Récap du canal · à valider',
    lines: [`Rien ne part sans ton clic. Il sera publié sur le canal source, le miroir UK et le canal IT (traduit).`, '', recap.text],
    path: '/',
    tag: 'channel-recap',
    buttons: [{ text: '✅ PUBLIER', data: `crp:${day}` }, { text: '❌ Pas ce soir', data: `crx:${day}` }],
  });
  return { status: 'drafted', recap };
}

/** Boutons ✅ / ❌ sous le brouillon (webhook Telegram). Renvoie false si le bouton n'est pas le nôtre. */
export async function handleRecapCallback(db: Db, cq: { id: string; data?: string; from?: { id?: number; username?: string }; message?: { chat?: { id?: number }; message_id?: number; text?: string } }): Promise<boolean> {
  const m = /^cr([px]):(\d{4}-\d{2}-\d{2})$/.exec(String(cq?.data ?? ''));
  if (!m) return false;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const tg = (method: string, payload: Record<string, unknown>) => token ? fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(4000), body: JSON.stringify(payload) }).catch(() => null) : null;
  const answer = (text: string) => tg('answerCallbackQuery', { callback_query_id: cq.id, text: text.slice(0, 190) });
  const stamp = async (line: string) => {
    if (cq.message?.chat?.id && cq.message?.message_id) await tg('editMessageText', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text: `${cq.message.text ?? ''}\n\n${line}`.slice(0, 4000), disable_web_page_preview: true });
  };
  if (!(await adminTgIds()).includes(Number(cq.from?.id))) { await answer('Réservé aux admins.'); return true; }
  const by = cq.from?.username ? `@${cq.from.username}` : String(cq.from?.id ?? 'admin');
  const day = m[2];
  // verrou : seul le premier clic fait passer la ligne de draft à « en cours » — deux admins, ou un double tap,
  // ne publient jamais deux fois
  const next = m[1] === 'p' ? 'publishing' : 'skipped';
  const { data: rows } = await db.from('channel_recaps').update({ status: next, decided_by: by, decided_at: new Date().toISOString() }).eq('day', day).eq('status', 'draft').select('day,text');
  const row = (rows ?? [])[0] as { day: string; text: string } | undefined;
  if (!row) { await answer('Déjà traité.'); return true; }
  if (m[1] === 'x') { await stamp(`❌ Pas publié ce soir (${by}).`); await answer('OK, rien ne part.'); return true; }
  const src = sourceChannel();
  if (!src) { await db.from('channel_recaps').update({ status: 'draft' }).eq('day', day); await answer('Canal source non configuré.'); return true; }
  const out = await publishToChannels(db, { chatId: src, text: esc(row.text) });
  // échec : la ligne repasse en brouillon, le bouton ✅ reste utilisable pour réessayer
  await db.from('channel_recaps').update({ status: out.ok ? 'published' : 'draft', message_id: out.ok ? out.messageId : null, report: out.report }).eq('day', day);
  const detail = out.report.map((r) => `${r.ok ? '✓' : '✗'} ${r.channel}${r.error ? ` (${r.error})` : ''}`).join(' · ');
  await stamp(out.ok ? `✅ Publié par ${by} · ${detail}` : `⨯ Telegram a refusé : ${out.error} · réessaie avec ✅`);
  await answer(out.ok ? 'Publié ✓' : 'Échec, voir le message.');
  return true;
}
