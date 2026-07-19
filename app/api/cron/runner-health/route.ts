import { NextResponse, type NextRequest } from 'next/server';
import { sdb } from '@/lib/member/server';
import { pushToAdmins } from '@/lib/push/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// WATCHDOG RUNNER — appelé par le cron Vercel (vercel.json). Le runner écrit une bougie M5 en continu
// (BTC coté 24/7 → heartbeat permanent, week-end compris). Si la dernière bougie date de > 20 min,
// le runner est mort/gelé → push aux admins. Throttle 60 min via un marqueur en base (pas de spam).
const STALE_MIN = 20;
const THROTTLE_MIN = 60;

export async function GET(req: NextRequest) {
  // Vercel Cron envoie Authorization: Bearer CRON_SECRET quand la variable est posée — on la vérifie si présente.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const db = sdb();
  const { data: last } = await db.from('candles').select('time').order('time', { ascending: false }).limit(1);
  const lastMs = last?.[0]?.time != null ? Number(last[0].time) : 0;
  const staleMin = lastMs ? Math.floor((Date.now() - lastMs) / 60_000) : Infinity;
  if (staleMin <= STALE_MIN) return NextResponse.json({ ok: true, staleMin });

  // en panne → alerte (throttlée : un marqueur 'watchdog-alert' en base, max 1/h)
  const { data: lastAlert } = await db.from('events').select('ts').eq('msg', 'watchdog-alert').order('ts', { ascending: false }).limit(1);
  const sinceAlert = lastAlert?.[0]?.ts ? (Date.now() - Date.parse(lastAlert[0].ts as string)) / 60_000 : Infinity;
  if (sinceAlert < THROTTLE_MIN) return NextResponse.json({ ok: false, staleMin, throttled: true });

  await db.from('events').insert({ ts: new Date().toISOString(), level: 'veto', msg: 'watchdog-alert', data: { staleMin } as never });
  await pushToAdmins({
    title: '🚨 ALGORIA RUNNER DOWN',
    body: `No candle written for ${staleMin === Infinity ? '∞' : staleMin} min — the runner looks dead or frozen. Check Railway.`,
    url: '/admin',
    tag: 'runner-watchdog',
  }).catch(() => {});
  return NextResponse.json({ ok: false, staleMin, alerted: true });
}
