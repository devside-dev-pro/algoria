'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

// Widget OBS (Browser Source) — le but : donner ENVIE de voir son nom passer.
// Chaque adhésion réelle devient un ÉVÉNEMENT : le nom s'affiche en GRAND dans le spotlight (halo, confettis,
// dégradé unique par pseudo), le compteur pop (+1), puis le nom glisse dans la file "latest members".
// Une barre "ROAD TO N" (prochain palier réel) donne un objectif collectif. Aucune fausse adhésion en mode réel :
// la mécanique "tu rejoins → tu te vois à l'écran" n'a de sens que si c'est vrai.
// URL : ?demo=1 (fausses adhésions pour caler la scène) · ?bg=transparent (fond transparent pour composer dans OBS)
type Join = { id: number | string; username: string | null; first_name: string | null; joined_at?: string };

const GRADS: [string, string][] = [
  ['#2be3f5', '#2e8bf0'], ['#f5c24a', '#ff8a3c'], ['#22e0a6', '#2be3f5'], ['#b78bff', '#5d5dff'],
  ['#ff6b8a', '#ffa53c'], ['#7ad0ff', '#2aa8ea'], ['#ffd166', '#f08c2e'], ['#5eead4', '#22c1a6'],
];
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
const gradOf = (s: string) => GRADS[hash(s) % GRADS.length];
const nameOf = (j: Join) => (j.username ? '@' + j.username : j.first_name || 'someone');
const initialOf = (j: Join) => (j.username || j.first_name || '?').charAt(0).toUpperCase();
const ago = (iso: string | undefined, now: number) => {
  if (!iso) return '';
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 8) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};
// prochain palier "rond" RÉEL au-dessus du compteur (objectif collectif honnête)
const nextMilestone = (n: number) => { const step = n < 500 ? 100 : n < 2000 ? 250 : n < 10000 ? 500 : 1000; return Math.max(step, Math.ceil((n + 1) / step) * step); };

const DEMO_NAMES = ['lucas_tr', 'sofia.k', 'mehdi92', 'emma_fx', 'yanis', 'clara.dv', 'ryan_b', 'nina_trades', 'samuel', 'aya.m', 'tomfx', 'lea_p', 'noah', 'ines', 'gabriel', 'driss'];

export default function JoinWidget() {
  const [list, setList] = useState<Join[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const transparent = useRef(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    transparent.current = q.get('bg') === 'transparent';
    const tick = setInterval(() => setNow(Date.now()), 8000); // rafraîchit les "Xs ago"

    if (q.get('demo') === '1') {
      let i = 6, c = 1284; // i démarre après les seeds (slice 0-6) → pas de doublon immédiat
      setCount(c);
      setList(DEMO_NAMES.slice(0, 6).map((n, k) => ({ id: 'seed' + k, username: n, first_name: null, joined_at: new Date(Date.now() - (k + 1) * 47_000).toISOString() })));
      const iv = setInterval(() => {
        const n = DEMO_NAMES[i++ % DEMO_NAMES.length];
        setList((p) => [{ id: 'd' + Date.now(), username: n, first_name: null, joined_at: new Date().toISOString() }, ...p].slice(0, 8));
        setCount((v) => (v ?? c) + 1);
      }, 4200);
      return () => { clearInterval(iv); clearInterval(tick); };
    }

    let alive = true;
    // table hors types générés → accès non typé (cast)
    (supabase as any).from('telegram_joins').select('*', { count: 'exact' }).order('joined_at', { ascending: false }).limit(8).then(({ data, count }: { data: Join[] | null; count: number | null }) => {
      if (!alive) return;
      if (data) setList(data);
      if (typeof count === 'number') setCount(count);
    });
    const ch = supabase
      .channel('rt-joins')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'telegram_joins' }, ({ new: j }) => {
        setList((p) => [j as unknown as Join, ...p].slice(0, 8));
        setCount((v) => (v ?? 0) + 1);
      })
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); clearInterval(tick); };
  }, []);

  const star = list[0] ?? null; // la dernière adhésion = spotlight
  const rest = list.slice(1, 6);
  const [g1, g2] = star ? gradOf(nameOf(star)) : ['#2be3f5', '#2e8bf0'];
  const milestone = count != null ? nextMilestone(count) : null;
  const progress = count != null && milestone ? Math.min(1, count / milestone) : 0;

  return (
    <main style={{ minHeight: '100dvh', background: transparent.current ? 'transparent' : 'radial-gradient(120% 90% at 50% -10%, #0d2136 0%, #070b12 62%)', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, position: 'relative', overflow: 'hidden' }}>
      <style>{`
        @keyframes borderSpin{to{transform:rotate(360deg)}}
        @keyframes popIn{0%{opacity:0;transform:translateY(14px) scale(.92)}60%{transform:translateY(-2px) scale(1.02)}100%{opacity:1;transform:none}}
        @keyframes rowIn{from{opacity:0;transform:translateY(-7px)}to{opacity:1;transform:none}}
        @keyframes floatUp{0%{opacity:0;transform:translateY(4px)}25%{opacity:1}100%{opacity:0;transform:translateY(-22px)}}
        @keyframes shine{0%{transform:translateX(-130%) skewX(-18deg)}100%{transform:translateX(230%) skewX(-18deg)}}
        @keyframes confetti{0%{opacity:1;transform:translate(0,0) scale(1) rotate(0)}100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(.4) rotate(240deg)}}
        @keyframes drift{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
        @keyframes pulseDot2{0%,100%{opacity:1}50%{opacity:.35}}
      `}</style>

      {/* particules d'ambiance (pas en mode transparent) */}
      {!transparent.current && [0, 1, 2, 3, 4, 5].map((i) => (
        <span key={i} aria-hidden style={{ position: 'absolute', left: `${12 + i * 15}%`, top: `${18 + (i % 3) * 26}%`, width: 4 + (i % 3) * 2, height: 4 + (i % 3) * 2, borderRadius: '50%', background: i % 2 ? 'rgba(43,227,245,.25)' : 'rgba(245,194,74,.22)', filter: 'blur(1px)', animation: `drift ${6 + i}s ease-in-out ${i * 0.7}s infinite` }} />
      ))}

      {/* panneau à liseré animé */}
      <div style={{ position: 'relative', width: '100%', maxWidth: 640, borderRadius: 22, padding: 1.5, overflow: 'hidden' }}>
        <span aria-hidden style={{ position: 'absolute', inset: -180, background: 'conic-gradient(from 0deg, transparent 0 40%, rgba(43,227,245,.55) 50%, transparent 60% 100%)', animation: 'borderSpin 7s linear infinite' }} />
        <section style={{ position: 'relative', borderRadius: 20.5, background: 'linear-gradient(180deg, rgba(16,28,48,.97), rgba(9,14,26,.97))', padding: '18px 20px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* header : CTA + compteur */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
            <span style={{ width: 44, height: 44, borderRadius: 13, background: 'linear-gradient(135deg,#2aa8ea,#1e6fe0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flex: 'none', boxShadow: '0 6px 22px rgba(42,168,234,.45)' }}>✈️</span>
            <div style={{ lineHeight: 1.15 }}>
              <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: .3, color: '#f2f8ff' }}>ALGORIA <span style={{ background: 'linear-gradient(90deg,#2be3f5,#f5c24a)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>WAITLIST</span></div>
              <div style={{ fontSize: 12.5, color: '#8fb8d9', display: 'flex', alignItems: 'center', gap: 6 }}>
                link in bio 🔗 · get in line, free
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#ff5a6e', fontWeight: 800, fontSize: 10, letterSpacing: .8 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff5a6e', animation: 'pulseDot2 1.3s infinite' }} />LIVE</span>
              </div>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right', position: 'relative' }}>
              {/* +1 flottant à chaque entrée en liste */}
              {count != null && <span key={count} aria-hidden className="mono" style={{ position: 'absolute', right: 0, top: -14, fontSize: 13, fontWeight: 800, color: 'var(--up)', animation: 'floatUp 1.6s ease forwards' }}>+1</span>}
              <div key={'c' + (count ?? 0)} className="mono" style={{ fontSize: 30, fontWeight: 800, color: '#f2f8ff', lineHeight: 1, animation: 'popIn .45s ease' }}>{count != null ? count.toLocaleString('en-US') : '—'}</div>
              <div style={{ fontSize: 10, color: '#8fb8d9', letterSpacing: 1.2, textTransform: 'uppercase' }}>in line</div>
            </div>
          </div>

          {/* SPOTLIGHT — la dernière adhésion, en grand */}
          {star ? (
            <div key={String(star.id)} style={{ position: 'relative', borderRadius: 16, padding: '18px 16px 16px', textAlign: 'center', overflow: 'hidden', background: `radial-gradient(90% 130% at 50% 0%, ${g1}22 0%, rgba(255,255,255,.02) 55%)`, border: `1px solid ${g1}55`, animation: 'popIn .5s cubic-bezier(.2,.9,.3,1.2)' }}>
              {/* balayage lumineux */}
              <span aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, width: '38%', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.09), transparent)', animation: 'shine 2.8s ease .3s 2' }} />
              {/* confettis (rejoués à chaque nouvelle adhésion via key) */}
              {[...Array(12)].map((_, i) => (
                <span key={i} aria-hidden style={{ position: 'absolute', left: '50%', top: '38%', width: 6, height: i % 3 ? 6 : 9, borderRadius: i % 2 ? '50%' : 2, background: i % 2 ? g1 : g2, ['--dx' as string]: `${Math.cos((i / 12) * 6.283) * (60 + (i % 4) * 26)}px`, ['--dy' as string]: `${Math.sin((i / 12) * 6.283) * (34 + (i % 3) * 22) - 26}px`, animation: `confetti ${0.9 + (i % 4) * 0.18}s ease-out forwards` }} />
              ))}
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 2.4, color: '#9fc7e6', marginBottom: 7 }}>🎟 JOINED THE WAITLIST</div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, maxWidth: '100%' }}>
                <span style={{ width: 46, height: 46, borderRadius: '50%', flex: 'none', background: `linear-gradient(135deg,${g1},${g2})`, color: '#06121f', fontWeight: 900, fontSize: 21, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 26px ${g1}66` }}>{initialOf(star)}</span>
                <span style={{ fontSize: 'clamp(24px, 5.4vw, 34px)', fontWeight: 800, letterSpacing: .2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', background: `linear-gradient(90deg,${g1},${g2})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', filter: `drop-shadow(0 0 14px ${g1}44)` }}>{nameOf(star)}</span>
              </div>
              <div style={{ fontSize: 12, color: '#b9d4ec', marginTop: 7 }}>in line for approval · <b style={{ color: 'var(--up)' }}>{ago(star.joined_at, now) || 'now'}</b></div>
            </div>
          ) : (
            <div style={{ borderRadius: 16, padding: '22px 16px', textAlign: 'center', border: '1.5px dashed rgba(43,227,245,.4)', background: 'rgba(43,227,245,.04)' }}>
              <div style={{ fontSize: 'clamp(20px, 5vw, 28px)', fontWeight: 800, letterSpacing: .4, background: 'linear-gradient(90deg,#2be3f5,#f5c24a)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>YOUR NAME HERE</div>
              <div style={{ fontSize: 12.5, color: '#8fb8d9', marginTop: 6 }}>be first in line — join from the link in bio</div>
            </div>
          )}

          {/* file des adhésions précédentes */}
          {rest.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {rest.map((j, i) => {
                const [a, b] = gradOf(nameOf(j));
                return (
                  <div key={String(j.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 10, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(130,152,190,.12)', opacity: Math.max(.45, 1 - i * .14), animation: 'rowIn .3s ease' }}>
                    <span style={{ width: 26, height: 26, borderRadius: '50%', flex: 'none', background: `linear-gradient(135deg,${a},${b})`, color: '#06121f', fontWeight: 800, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initialOf(j)}</span>
                    <span style={{ fontSize: 14.5, fontWeight: 600, color: '#dbe9f8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nameOf(j)}</span>
                    <span className="mono" style={{ marginLeft: 'auto', fontSize: 10.5, color: '#7d95b5', flex: 'none' }}>{ago(j.joined_at, now)}</span>
                    <span style={{ fontSize: 11, flex: 'none' }} title="waiting for approval">⏳</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* ROAD TO — objectif collectif réel */}
          {count != null && milestone && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: '#9fc7e6', flex: 'none' }}>ROAD&nbsp;TO&nbsp;{milestone.toLocaleString('en-US')}</span>
              <span style={{ flex: 1, height: 7, borderRadius: 4, background: 'rgba(255,255,255,.06)', overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${Math.round(progress * 100)}%`, borderRadius: 4, background: 'linear-gradient(90deg,#2aa8ea,#2be3f5,#f5c24a)', boxShadow: '0 0 12px rgba(43,227,245,.5)', transition: 'width .8s cubic-bezier(.2,.8,.2,1)' }} />
              </span>
              <span className="mono" style={{ fontSize: 11, color: '#b9d4ec', flex: 'none' }}>{Math.max(0, milestone - count)} to go</span>
            </div>
          )}

          {/* teaser des drops — l'approbation se joue EN LIVE (ex. « à 10k likes j'accepte 10 personnes ») */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontSize: 11.5, color: '#f5c24a', background: 'rgba(245,194,74,.07)', border: '1px solid rgba(245,194,74,.25)', borderRadius: 9, padding: '6px 10px' }}>
            🔓 <b>batches accepted LIVE on stream</b> <span style={{ color: '#c8b07a' }}>— stay to get in</span>
          </div>
        </section>
      </div>
    </main>
  );
}
