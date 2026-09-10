import { NextResponse, type NextRequest } from 'next/server';
import { sdb } from '@/lib/member/server';
import { pushToAll } from '@/lib/push/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ANNONCE DU DESK (10/09/2026, phase 5) — appelée par le cron Vercel après l'analyse de 06:00 UTC.
// Une analyse écrite que personne ne voit ne sert à rien : cette route prévient les membres que la lecture
// du jour est en ligne, et met la carte dans le VIP quand Mathieu l'autorise.
//
// Trois règles, dans l'ordre d'importance :
//  1. UNE SEULE FOIS par analyse — `desk_runs.announced_at` (migration algoria_desk_runs_announced_at) ;
//     rejouer la route ne renvoie rien. Elle rattrape une analyse en retard (publiée après le cron de la
//     veille) tant qu'elle est la plus récente en attente. Une lecture plus ancienne que celle du jour est
//     classée sans notification : personne ne veut être réveillé pour l'analyse d'avant-hier.
//  2. LE VIP NE PARLE PAS TOUT SEUL. Décision Mathieu du 09/09 : plus aucun post automatique dans les canaux.
//     Le post VIP est donc derrière DESK_VIP_POST=1, absent par défaut — la route ne peut pas publier sans
//     qu'il l'ait décidé. Le push aux membres, lui, est de l'app vers ses propres membres : pas un canal.
//  3. DU CONTENU, JAMAIS UNE PROMESSE — le texte reprend le titre du brief et rien d'autre ; ni chiffre de
//     performance, ni « achète », ni objectif de gain.
//
// Env : CRON_SECRET (posée par Vercel), DESK_VIP_POST, TELEGRAM_BOT_TOKEN + TELEGRAM_VIP_CHAT (post VIP),
//       APP_URL (défaut https://app.algoria.tech — l'URL que Telegram doit pouvoir atteindre pour la carte).
const LOOKBACK_DAYS = 3;
const APP_URL = (process.env.APP_URL ?? 'https://app.algoria.tech').replace(/\/$/, '');
const LABEL: Record<string, string> = { XAUUSD: 'GOLD', BTCUSD: 'BTC' };
const WORD: Record<string, string> = { Buy: 'BUY', Overweight: 'OVERWEIGHT', Hold: 'HOLD', Underweight: 'UNDERWEIGHT', Sell: 'SELL' };

interface Row { id: string; market: string; run_date: string; rating: string; brief: { headline?: string; call?: string } | null }

const label = (m: string) => LABEL[m] ?? m;
const word = (r: string) => WORD[r] ?? 'NO CALL';
const dateLabel = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Le résumé VIP d'un marché : la note, le titre, ce que le desk en fait, et où lire le reste. */
function vipCaption(r: Row): string {
  const b = r.brief ?? {};
  const lines = [
    `<b>ALGORIA DESK · ${label(r.market)} · ${dateLabel(r.run_date).toUpperCase()}</b>`,
    '',
    `<b>${word(r.rating)}</b>${b.headline ? ` — ${b.headline}` : ''}`,
  ];
  if (b.call) lines.push('', b.call);
  lines.push('', `The full reasoning of all the analysts is in the app: ${APP_URL}/member/live`, '', '<i>Reading material, not a promise.</i>');
  return lines.join('\n');
}

async function postVipCard(r: Row): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_VIP_CHAT;
  if (!token || !chat) return false; // pas configuré ici → on ne poste pas, et on ne casse rien
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, photo: `${APP_URL}/api/card/desk?market=${r.market}`, caption: vipCaption(r), parse_mode: 'HTML' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const dry = req.nextUrl.searchParams.get('dry') === '1'; // aperçu : ne pousse rien, ne marque rien
  const db = sdb() as unknown as { from: (t: string) => any };
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { data } = await db
    .from('desk_runs')
    .select('id,market,run_date,rating,brief')
    .eq('published', true).eq('dry_run', false).is('announced_at', null).gte('run_date', since)
    .order('run_date', { ascending: true });

  // sans brief, il n'y a rien de lisible à annoncer : on attend le passage qui le complétera
  const runs = ((data ?? []) as Row[]).filter((r) => r.brief && String(r.brief.headline ?? '').trim());
  if (!runs.length) {
    console.log(`[desk-publish] rien à annoncer (${((data ?? []) as Row[]).length} analyse(s) sans brief)`);
    return NextResponse.json({ ok: true, announced: 0 });
  }

  // une seule notification, même quand les deux marchés sortent ensemble : deux buzz d'affilée, c'est du spam
  const day = runs[runs.length - 1].run_date;
  const ofDay = runs.filter((r) => r.run_date === day);
  const head = ofDay[0];
  const body = ofDay.length > 1
    ? `${ofDay.map((r) => `${label(r.market)} ${word(r.rating)}`).join(' · ')} — today's read, in plain English.`
    : `${label(head.market)} ${word(head.rating)} — ${String(head.brief?.headline ?? '').slice(0, 120)}`;

  if (dry) return NextResponse.json({ ok: true, dry: true, day, markets: ofDay.map((r) => r.market), body, vip: ofDay.map(vipCaption) });

  const pushed = await pushToAll({ title: `ALGORIA DESK · ${dateLabel(day).toUpperCase()}`, body, url: '/member/live', tag: 'algoria-desk' }).catch(() => 0);
  const vipOn = process.env.DESK_VIP_POST === '1';
  let vipSent = 0;
  if (vipOn) for (const r of ofDay) if (await postVipCard(r)) vipSent++;

  // Les analyses plus anciennes encore en attente sont classées sans notification : on ne réveille personne
  // pour la lecture d'avant-hier. Sans ça elles resteraient éternellement « à annoncer » et fausseraient le
  // compte (constaté le 10/09 : les deux analyses du 09/09 traînaient en attente).
  const stale = runs.filter((r) => r.run_date !== day).map((r) => r.id);
  const now = new Date().toISOString();
  await db.from('desk_runs').update({ announced_at: now }).in('id', [...ofDay.map((r) => r.id), ...stale]);
  // Journalisé, parce que le corps de la réponse d'un cron ne se lit nulle part : sans cette ligne, savoir ce
  // qui est parti demande un accès à la base (vécu le 10/09, connecteur Supabase indisponible au moment de vérifier).
  const skipped = ((data ?? []) as Row[]).length - runs.length;
  console.log(`[desk-publish] ${day} · ${ofDay.map((r) => r.market).join(',')} · push ${pushed} · vip ${vipOn ? vipSent : 'off'}${skipped ? ` · ${skipped} sans brief, non annoncée(s)` : ''}${stale.length ? ` · ${stale.length} plus ancienne(s) classée(s) sans notification` : ''} · « ${body} »`);
  return NextResponse.json({ ok: true, day, announced: ofDay.length, markets: ofDay.map((r) => r.market), pushed, vip: vipOn ? vipSent : 'off', skipped, stale: stale.length });
}
