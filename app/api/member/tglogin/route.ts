import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { sdb, signSession, SESSION_COOKIE, newReferralCode } from '@/lib/member/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Connexion Telegram NATIVE — POST crée un code à usage unique + le deep-link t.me ; GET (polling) vérifie :
// le webhook /api/telegram confirme le code quand l'utilisateur tape START dans Telegram (zéro numéro, zéro widget).

export async function POST() {
  const code = randomBytes(16).toString('hex');
  const { error } = await sdb().from('member_login_codes').insert({ code });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? '';
  return NextResponse.json({ code, link: `https://t.me/${bot}?start=lg_${code}` });
}

export async function GET(req: NextRequest) {
  const code = new URL(req.url).searchParams.get('code') ?? '';
  if (!/^[A-Za-z0-9]{16,64}$/.test(code)) return NextResponse.json({ error: 'bad code' }, { status: 400 });
  const db = sdb();
  const { data } = await db.from('member_login_codes').select('*').eq('code', code).limit(1);
  const row = data?.[0] as { status: string; tg_id: number | null; tg_username: string | null; tg_name: string | null; photo_url: string | null; created_at: string } | undefined;
  if (!row || Date.now() - Date.parse(row.created_at) > 10 * 60_000) return NextResponse.json({ expired: true });
  if (row.status !== 'confirmed' || !row.tg_id) return NextResponse.json({ pending: true });

  // code confirmé → usage unique (anti-rejeu)
  await db.from('member_login_codes').update({ status: 'used' }).eq('code', code);

  // BANNIS : aucune session posée (31/07 — un concurrent capturait l'app pour la copier). On refuse ICI,
  // avant le cookie : la page de login attendait déjà `denied` et redirige vers /member/denied.
  const { data: banRow } = await (db as any).from('members').select('banned_at').eq('tg_id', row.tg_id).limit(1) as { data: Array<{ banned_at: string | null }> | null };
  if (banRow?.[0]?.banned_at) return NextResponse.json({ denied: true });

  // PORTE OUVERTE À TOUS (stratégie teaser/FOMO) : plus aucune waitlist à la connexion — n'importe quel
  // compte Telegram entre et voit l'app en mode grisé (gains en clair, flux verrouillé, paywall broker).
  // Le VRAI filtre n'a pas bougé : l'approbation admin (compte via notre lien + dépôt ≥ 500$) débloque tout.
  // Chaque visiteur devient un LEAD visible dans le CRM au lieu d'un rebond sur une page fermée.
  // PARRAINAGE : un lien /r/<code> valide (cookie) attache le filleul à son parrain. Auto-parrainage exclu.
  const refCookie = (req.cookies.get('alg_ref')?.value ?? '').toLowerCase();
  let referrerTg: number | null = null;
  if (/^[a-f0-9]{6,12}$/.test(refCookie)) {
    const { data: r } = await db.from('members').select('tg_id').eq('referral_code', refCookie).limit(1);
    if (r?.length && Number(r[0].tg_id) !== row.tg_id) referrerTg = Number(r[0].tg_id);
  }

  // ATTRIBUTION : canal d'origine (cookie alg_src posé par le middleware au premier clic UTM) — figé à la
  // CRÉATION uniquement, comme referred_by. Absent = organique/cross-device (attribution partielle assumée).
  const srcCookie = (req.cookies.get('alg_src')?.value ?? '').toLowerCase().slice(0, 60);
  const source = /^[a-z0-9:_-]{2,60}$/.test(srcCookie) ? srcCookie : null;

  const patch = { tg_username: row.tg_username, tg_name: row.tg_name, ...(row.photo_url ? { photo_url: row.photo_url } : {}), updated_at: new Date().toISOString() };
  const { data: existing } = await db.from('members').select('id').eq('tg_id', row.tg_id).limit(1);
  if (existing?.length) await db.from('members').update(patch).eq('tg_id', row.tg_id); // referred_by/source ne s'écrivent qu'à la CRÉATION
  else await (db as any).from('members').insert({ tg_id: row.tg_id, ...patch, referral_code: newReferralCode(), ...(referrerTg != null ? { referred_by: referrerTg } : {}), ...(source ? { source } : {}) });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, signSession({ tgId: row.tg_id, username: row.tg_username, name: row.tg_name ?? String(row.tg_id), iat: Date.now() }), {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 30 * 86_400,
  });
  return res;
}
