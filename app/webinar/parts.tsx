'use client';
// Les deux morceaux interactifs de la page /webinar : le bouton qui ouvre le bot (deep link tg:// d'abord, voir
// lib/telegram.ts) et l'heure de la session dans le fuseau du visiteur (connu seulement dans son navigateur).
import { useEffect, useState } from 'react';
import { tgHref } from '@/lib/telegram';

export function SeatButton({ href, label }: { href: string; label: string }) {
  return (
    <a {...tgHref(href)} rel="noopener noreferrer" style={{
      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      padding: '16px 20px', borderRadius: 14, textDecoration: 'none', fontSize: 17, fontWeight: 800, letterSpacing: 0.3,
      color: '#04223a', background: 'linear-gradient(90deg,#2be3f5,#39a0ff)', boxShadow: '0 10px 30px rgba(43,227,245,.28)',
    }}>
      {label}
    </a>
  );
}

/** « = Wed 21:00 your time », seulement si l'heure du visiteur diffère de celle du Royaume-Uni. */
export function LocalTime({ at }: { at: string }) {
  const [txt, setTxt] = useState<string | null>(null);
  useEffect(() => {
    const opts = { weekday: 'short', hour: '2-digit', minute: '2-digit' } as const;
    const mine = new Date(at).toLocaleString('en-GB', opts);
    const uk = new Date(at).toLocaleString('en-GB', { ...opts, timeZone: 'Europe/London' });
    setTxt(mine !== uk ? `= ${mine} your time` : null);
  }, [at]);
  return txt ? <span style={{ fontSize: 13, color: 'var(--cyan)' }}>{txt}</span> : null;
}
