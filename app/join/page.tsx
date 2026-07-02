'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

// Widget OBS (Browser Source) : liste des adhésions Telegram EN DIRECT + compteur + CTA.
// Données RÉELLES via Supabase (table telegram_joins, alimentée par le bot). Jamais de faux membres :
// la mécanique "tu rejoins → tu te vois défiler" n'a de sens que si c'est vrai.
// Options d'URL : ?demo=1 (fausses adhésions pour caler le layout) · ?bg=transparent (fond transparent pour composer)
type Join = { id: number | string; username: string | null; first_name: string | null; joined_at?: string };

export default function JoinWidget() {
  const [list, setList] = useState<Join[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const demo = useRef(false);
  const transparent = useRef(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    demo.current = q.get('demo') === '1';
    transparent.current = q.get('bg') === 'transparent';

    if (demo.current) {
      const names = ['lucas_tr', 'sofia.k', 'mehdi92', 'emma_fx', 'yanis', 'clara.dv', 'ryan_b', 'nina', 'samuel', 'aya.m', 'tom', 'lea_p', 'noah', 'ines', 'gabriel', 'driss'];
      let i = 0, c = 1284;
      setCount(c);
      setList(names.slice(0, 9).map((n, k) => ({ id: 'seed' + k, username: n, first_name: null })));
      const iv = setInterval(() => {
        const n = names[i++ % names.length];
        setList((p) => [{ id: 'd' + Date.now(), username: n, first_name: null }, ...p].slice(0, 12));
        setCount((v) => (v ?? c) + 1);
      }, 2600);
      return () => clearInterval(iv);
    }

    let alive = true;
    // table hors types générés → accès non typé (cast)
    (supabase as any).from('telegram_joins').select('*', { count: 'exact' }).order('joined_at', { ascending: false }).limit(12).then(({ data, count }: { data: Join[] | null; count: number | null }) => {
      if (!alive) return;
      if (data) setList(data);
      if (typeof count === 'number') setCount(count);
    });
    const ch = supabase
      .channel('rt-joins')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'telegram_joins' }, ({ new: j }) => {
        setList((p) => [j as unknown as Join, ...p].slice(0, 12));
        setCount((v) => (v ?? 0) + 1);
      })
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, []);

  const nameOf = (j: Join) => (j.username ? '@' + j.username : j.first_name || 'someone');
  const initial = (j: Join) => (j.username || j.first_name || '?').charAt(0).toUpperCase();

  return (
    <main style={{ minHeight: '100dvh', background: transparent.current ? 'transparent' : 'radial-gradient(120% 80% at 50% 0%, #0d2136 0%, #070b12 65%)', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14, fontFamily: 'var(--font-display), sans-serif' }}>
      <style>{`@keyframes joinIn{from{opacity:0;transform:translateY(-8px) scale(.98)}to{opacity:1;transform:none}}`}</style>
      <section style={{ width: '100%', maxWidth: 620, background: 'linear-gradient(180deg, rgba(42,168,234,.16), rgba(14,22,38,.94))', border: '1px solid rgba(42,168,234,.45)', borderRadius: 18, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 12px 40px rgba(0,0,0,.4)' }}>
        {/* CTA header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 42, height: 42, borderRadius: '50%', background: '#2aa8ea', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flex: 'none', boxShadow: '0 0 20px rgba(42,168,234,.5)' }}>✈️</span>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#eaf6ff' }}>JOIN ALGORIA — FREE</div>
            <div style={{ fontSize: 13, color: '#9fc7e6' }}>link in bio 🔗 · see your name pop up live</div>
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div className="mono" style={{ fontSize: 26, fontWeight: 800, color: '#eaf6ff', lineHeight: 1 }}>{count != null ? count.toLocaleString('en-US') : '—'}</div>
            <div style={{ fontSize: 10, color: '#9fc7e6', letterSpacing: 0.5, textTransform: 'uppercase' }}>members</div>
          </div>
        </div>

        {/* Live joins */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minHeight: 120 }}>
          {list.length === 0 && (
            <div style={{ textAlign: 'center', color: '#9fc7e6', fontSize: 15, padding: '24px 0' }}>Be the first to join 👇</div>
          )}
          {list.map((j, i) => (
            <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '7px 10px', borderRadius: 10, background: i === 0 ? 'rgba(42,168,234,.14)' : 'rgba(255,255,255,.02)', border: i === 0 ? '1px solid rgba(42,168,234,.4)' : '1px solid transparent', animation: i === 0 ? 'joinIn .35s ease' : undefined }}>
              <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,#2aa8ea,#7ad0ff)', color: '#04223a', fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{initial(j)}</span>
              <span style={{ fontSize: 16, fontWeight: 600, color: '#eaf1fb' }}>{nameOf(j)}</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--up)' }}>just joined ✓</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
