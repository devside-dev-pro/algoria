'use client';
// AVANT D'ARRÊTER LA COPIE (01/10/2026) — s'ouvre quand un membre touche ⏸ PAUSE ou « Disconnect ».
//
// Constat : 6 des 10 déposants partis ont coupé la copie EUX-MÊMES, d'un tap, souvent un jour rouge — trois
// en dix minutes le 23/09, le seul jour rouge de la semaine, effacé dès le lendemain. Ils ont gardé la perte
// et raté la suite. On ne les retient pas : on leur montre les faits PASSÉS du compte copié (jours rouges,
// délai de rattrapage, y compris le plus long) et une porte vers Mathieu. Arrêter reste à un tap.
// Règles : uniquement du passé, jamais de promesse ; le plus long rattrapage est affiché, pas seulement la médiane.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { redDayStats, type RedDayStats, type TrackDayLite } from '@/lib/member/redDays';

export function StopCopySheet({ kind, onKeep, onStop }: { kind: 'pause' | 'disconnect' | null; onKeep: () => void; onStop: () => void }) {
  const [stats, setStats] = useState<RedDayStats | null>(null);
  useEffect(() => {
    if (!kind || stats) return;
    void fetch('/api/public/track')
      .then(async (r) => (r.ok ? ((await r.json()) as { days?: TrackDayLite[] }) : null))
      .then((t) => { if (t?.days?.length) setStats(redDayStats(t.days)); })
      .catch(() => {});
  }, [kind, stats]);
  if (!kind) return null;
  const pause = kind === 'pause';

  return createPortal(
    <div onClick={onKeep} style={{ position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(3,7,15,.74)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div
        className="cardIn"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 560, borderRadius: '22px 22px 0 0', borderBottom: 'none',
          border: '1px solid rgba(43,227,245,.32)', background: 'linear-gradient(180deg, var(--panel-top) 0%, var(--panel-bottom) 100%)',
          boxShadow: '0 -18px 60px var(--drop)',
          padding: '20px 20px max(24px, env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 12,
          maxHeight: '86dvh', overflowY: 'auto',
        }}
      >
        <span style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(130,152,190,.35)', margin: '0 auto' }} />
        <h2 style={{ margin: 0, fontSize: 19, textAlign: 'center' }}>{pause ? '⏸ Pause the copy\u00a0?' : '🔌 Disconnect your account\u00a0?'}</h2>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55, textAlign: 'center' }}>
          Before you decide, here are the real past numbers of the account Algoria copies.
        </p>

        {stats && stats.red > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-around', gap: 8, textAlign: 'center' }}>
              <Stat value={String(stats.tradingDays)} label="trading days" />
              <Stat value={String(stats.red)} label="red days" color="rgba(255,107,138,.95)" />
              <Stat value={`${stats.recovered}/${stats.red}`} label="recovered" color="var(--up)" />
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text)', lineHeight: 1.55 }}>
              {stats.medianDays != null && <>After a red day, the account was usually back above its previous level within <b>{stats.medianDays} trading day{stats.medianDays > 1 ? 's' : ''}</b>. </>}
              {stats.maxDays != null && stats.maxDays !== stats.medianDays && <>The longest took <b>{stats.maxDays} trading days</b>. </>}
              {stats.stillOpen && <>The most recent red day is not recovered yet. </>}
              A member who stops right after a red day keeps that loss and misses the days that follow.
            </p>
            <p style={{ margin: 0, fontSize: 10.5, color: 'var(--dim)', lineHeight: 1.5 }}>
              Past results do not guarantee future results. <a href="https://algoria.tech/track-record" style={{ color: 'var(--cyan)' }}>See every trade →</a>
            </p>
          </div>
        )}

        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', lineHeight: 1.55, textAlign: 'center' }}>
          {pause
            ? 'A pause is reversible in one tap. Your money stays on your own broker account either way.'
            : 'Disconnecting stops the copy, and you will re-enter your MT5 details to reconnect. Your money stays on your own broker account either way.'}
        </p>

        <button onClick={onKeep} style={{ padding: '14px 16px', borderRadius: 13, border: 'none', cursor: 'pointer', fontWeight: 800, letterSpacing: 0.6, fontSize: 14, color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#22c55e)' }}>
          KEEP COPYING
        </button>
        <a href="https://t.me/mathieu_algoria" target="_blank" rel="noreferrer"
          style={{ padding: '12px 16px', borderRadius: 13, border: '1px solid rgba(43,227,245,.35)', textAlign: 'center', textDecoration: 'none', fontWeight: 700, fontSize: 13, color: 'var(--cyan)' }}>
          💬 Talk to Mathieu first
        </a>
        <button onClick={onStop} style={{ alignSelf: 'center', border: 'none', background: 'transparent', color: 'rgba(210,150,165,.9)', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '6px 10px', textDecoration: 'underline' }}>
          {pause ? 'Pause anyway' : 'Disconnect anyway'}
        </button>
      </div>
    </div>,
    document.body
  );
}

function Stat({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="mono" style={{ fontSize: 18, fontWeight: 800, color: color ?? 'var(--text)' }}>{value}</span>
      <span style={{ fontSize: 9.5, letterSpacing: 1, color: 'var(--dim)', textTransform: 'uppercase' }}>{label}</span>
    </div>
  );
}
