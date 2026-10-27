// 🎤 LA PAGE D'INSCRIPTION AUX WEBINAIRES (24/10/2026) — getalgoria.com/webinar (et app.getalgoria.com/webinar).
// Le bouton ouvre le bot sur /start wb_<session> : un tap, START, inscrit (voir lib/member/webinar.ts). Les sessions
// viennent de la table webinar_sessions ; le lien Zoom n'apparaît jamais ici, il part en privé aux inscrits.
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { sdb } from '@/lib/member/server';
import { calendarLink, isChannelSource, seatLink, ukDay, ukHour, upcomingSessions, type WebinarSession } from '@/lib/member/webinar';
import { LegalLinks } from '@/components/LegalLinks';
import { LocalTime, SeatButton } from './parts';

export const dynamic = 'force-dynamic';
// l'aperçu du lien quand il est partagé dans le canal ou en DM (sinon celui de la page d'accueil)
// l'accroche se comprend sans contexte (Mathieu, 24/10 : « les 6 heures par jour », c'est son histoire, pas une accroche)
const SHARE = { title: 'Live webinar: how an AI trades gold on your own account', description: '45 minutes live with Mathieu, founder of Algoria. Free, on Zoom.' };
export const metadata: Metadata = {
  title: 'Live webinar · Algoria',
  description: 'How an AI trades gold on your own account: 45 minutes live with Mathieu, founder of Algoria.',
  openGraph: { ...SHARE, url: 'https://getalgoria.com/webinar', siteName: 'Algoria AI', type: 'website', images: [{ url: 'https://getalgoria.com/webinar/mathieu.jpg', width: 640, height: 800, alt: 'Mathieu, founder of Algoria' }] },
  twitter: { card: 'summary_large_image', ...SHARE, images: ['https://getalgoria.com/webinar/mathieu.jpg'] },
};

const CHANNEL = process.env.NEXT_PUBLIC_TELEGRAM_URL || 'https://t.me/';

const AGENDA: Array<[string, string]> = [
  ['🥇', 'My story: from 6 hours a day on the gold charts to an AI that trades for me.'],
  ['🤖', 'What AI really is, and why 2026 changes everything.'],
  ['📲', 'How it works, with real screenshots of the app and MetaTrader.'],
  ['📊', 'Real past results, red days included.'],
];
const FAQ: Array<[string, string]> = [
  ['Is it free?', 'Yes. No card, no payment.'],
  ['Do I need to know trading?', 'No. It’s made for beginners.'],
  ['What do I need?', 'Zoom on your phone or computer. The link comes on Telegram, 1 hour before.'],
  ['Which language?', 'English.'],
];

const card = { width: '100%', borderRadius: 16, border: '1px solid var(--border)', background: 'rgba(10,17,31,.55)' } as const;
const label = { fontSize: 11.5, fontWeight: 800, letterSpacing: 2, color: 'var(--dim)' } as const;

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function Webinar({ searchParams }: { searchParams: Search }) {
  let sessions: WebinarSession[] = [];
  // UNE SEULE SESSION À LA FOIS (24/10/2026, Mathieu) : avec deux dates au choix, on remet au dimanche ce qu'on
  // pourrait faire mercredi. La suivante n'apparaît qu'une fois celle-ci passée (45 min après son début).
  try { sessions = await upcomingSessions(sdb(), 1); } catch { /* base injoignable : la page reste lisible */ }
  const next = sessions[0];
  const sp = await searchParams;
  const srcCookie = (await cookies()).get('alg_src')?.value ?? '';
  // ?src=channel sur CE clic, ou le cookie alg_src déjà posé (le middleware ne le réécrit pas : premier contact)
  const seat = (id: string) => seatLink(id, isChannelSource(one(sp.src)) || isChannelSource(srcCookie) ? 'channel' : undefined);

  return (
    <main style={{ minHeight: '100dvh', color: 'var(--text)', position: 'relative', overflowX: 'hidden', background: 'radial-gradient(90% 60% at 50% -10%, #0e1c33 0%, var(--bg,#070b12) 60%)' }}>
      <div style={{ position: 'relative', width: '100%', maxWidth: 520, margin: '0 auto', padding: '28px 20px 48px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, textAlign: 'center' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/brand/algoria-mark.png" alt="Algoria" width={30} height={30} style={{ objectFit: 'contain', filter: 'drop-shadow(0 0 9px rgba(43,227,245,.45))' }} />
          <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: 0.5, background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>ALGORIA&nbsp;AI</span>
        </div>

        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px', borderRadius: 999, border: '1px solid rgba(255,45,85,.5)', background: 'rgba(255,45,85,.1)', fontSize: 12, fontWeight: 800, letterSpacing: 1.5, color: '#ff8a9a' }}>
          <span className="pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff2d55' }} />
          LIVE WEBINAR · FREE · ON ZOOM
        </span>

        <h1 style={{ fontSize: 34, lineHeight: 1.12, fontWeight: 800, margin: 0 }}>
          How an AI trades gold{' '}
          <span style={{ background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>on your own account</span>
        </h1>
        <p style={{ fontSize: 15.5, color: 'var(--muted)', margin: 0, maxWidth: 420, lineHeight: 1.55 }}>
          45 minutes live with Mathieu, founder of Algoria: his story, the real app on screen, real past results, and your questions.
        </p>

        <div style={{ ...card, position: 'relative', overflow: 'hidden', aspectRatio: '4 / 5', maxWidth: 360 }}>
          <img src="/webinar/mathieu.jpg" alt="Mathieu, founder of Algoria, on stage" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '48px 18px 16px', background: 'linear-gradient(rgba(7,11,18,0), rgba(7,11,18,.92))', textAlign: 'left' }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>Mathieu</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>Gold trader since 2016 · founder of Algoria</div>
          </div>
        </div>

        <section style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span style={label}>{sessions.length > 1 ? 'PICK YOUR SESSION' : 'NEXT SESSION'}</span>
          {sessions.length ? sessions.map((s, i) => (
            <div key={s.id} style={{ ...card, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, borderColor: i === 0 ? 'rgba(43,227,245,.45)' : 'var(--border)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 18, fontWeight: 800 }}>{ukDay(s.starts_at)}</span>
                <span style={{ fontSize: 15, color: 'var(--muted)' }}>{ukHour(s.starts_at)} UK time · 45 min</span>
                <LocalTime at={s.starts_at} />
              </div>
              <SeatButton href={seat(s.id)} label="✈️ SAVE MY SEAT ON TELEGRAM" />
              <a href={calendarLink(s.id)} style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}>📅 Add to my calendar</a>
            </div>
          )) : (
            <div style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>New dates are coming soon.</span>
              <span style={{ fontSize: 14, color: 'var(--muted)' }}>They’re announced first in the Algoria channel.</span>
              <SeatButton href={CHANNEL} label="✈️ FOLLOW THE CHANNEL" />
            </div>
          )}
          {next && <span style={{ fontSize: 12.5, color: 'var(--dim)', lineHeight: 1.5 }}>1 tap: Telegram opens, press START, you’re in. The Zoom link comes 1 hour before.</span>}
        </section>

        <section style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'left' }}>
          <span style={label}>IN 45 MINUTES</span>
          {AGENDA.map(([e, t]) => (
            <div key={t} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 20, lineHeight: 1.2 }}>{e}</span>
              <span style={{ fontSize: 14.5, lineHeight: 1.5 }}>{t}</span>
            </div>
          ))}
        </section>

        <section style={{ width: '100%', borderRadius: 16, border: '1px solid rgba(245,194,74,.45)', background: 'rgba(245,194,74,.08)', padding: 18, display: 'flex', gap: 12, alignItems: 'center', textAlign: 'left' }}>
          <span style={{ fontSize: 28 }}>🎁</span>
          <span style={{ fontSize: 14.5, lineHeight: 1.5 }}><b style={{ color: 'var(--gold)' }}>At the end: a pack reserved for 10 people,</b> only for those who are there live.</span>
        </section>

        <section style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
          {FAQ.map(([q, a]) => (
            <div key={q} style={{ ...card, padding: '12px 16px' }}>
              <div style={{ fontSize: 14.5, fontWeight: 700 }}>{q}</div>
              <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 3 }}>{a}</div>
            </div>
          ))}
        </section>

        {next && <SeatButton href={seat(next.id)} label={`✈️ SAVE MY SEAT · ${ukDay(next.starts_at).toUpperCase()}`} />}

        <p style={{ fontSize: 11.5, color: 'var(--dim)', lineHeight: 1.6, margin: 0 }}>
          Educational webinar, not financial advice. Trading involves risk: you can lose part or all of your capital. Past results do not guarantee future results.
        </p>
        <LegalLinks />
      </div>
    </main>
  );
}
