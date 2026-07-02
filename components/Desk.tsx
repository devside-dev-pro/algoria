'use client';
import { useEffect, useState } from 'react';

// Desk ALGORIA AI — surface stream-first : un HERO fixe (« ce que fait le bot MAINTENANT ») + des cartes
// à structure fixe (spine · clause · rail/R-bar · chips). Les CHIFFRES viennent des champs structurés
// (emitted par runner/llm/narrate.ts:deskMeta) ; le LLM n'ajoute qu'UNE clause. Tout dégrade proprement.
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const num = (n: any) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n) >= 100 ? Number(n).toFixed(1) : Number(n).toFixed(2));
const hhmm = (ts: any) => (ts ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
const TONE: Record<string, string> = { bull: 'var(--up)', bear: 'var(--down)', neutral: 'var(--muted)', vol: 'var(--cyan)' };

function kindColor(m: any): string {
  if (m?.kind === 'opportunity') return 'var(--gold)';
  if (m?.kind === 'analysis') return 'var(--cyan)';
  return m?.direction === 'short' ? 'var(--down)' : m?.direction === 'long' ? 'var(--up)' : 'var(--muted)';
}
const glyph = (m: any) => (m?.direction === 'long' ? '▲' : m?.direction === 'short' ? '▼' : m?.kind === 'opportunity' ? '◆' : '●');
const tag = (m: any) => (m?.kind === 'trade' ? (m?.direction === 'long' ? 'LONG' : 'SHORT') : m?.kind === 'opportunity' ? 'WATCH' : 'READ');
const levelPrefix = (lk: string) => (lk === 'support' ? 'S' : lk === 'resistance' ? 'R' : '@');
const STATE_WORD: Record<string, string> = { in_long: 'IN LONG', in_short: 'IN SHORT', stalking_long: 'STALKING LONG', stalking_short: 'STALKING SHORT', aside: 'STANDING ASIDE' };

// jauge à 5 segments (armée = pleine, sinon 55% d'opacité)
function Meter({ conf, threshold, color, seg = 5 }: { conf: number; threshold: number; color: string; seg?: number }) {
  const filled = Math.round(conf * seg);
  const armed = conf >= threshold;
  return (
    <span style={{ display: 'inline-flex', gap: 1.5, alignItems: 'center' }} aria-label={`conviction ${Math.round(conf * 100)}%`}>
      {Array.from({ length: seg }).map((_, i) => (
        <span key={i} style={{ width: 5, height: 5, borderRadius: 1, background: i < filled ? color : 'rgba(255,255,255,.09)', opacity: i < filled && !armed ? 0.55 : 1 }} />
      ))}
    </span>
  );
}

// Bande d'état COMPACTE : une seule ligne (état · niveau) + un mince liseré de conviction dessous.
function StateHero({ m }: { m: any }) {
  const color = kindColor(m);
  const conf = typeof m?.confidence === 'number' ? m.confidence : null;
  const armed = conf != null && conf >= (m?.threshold ?? 0.72) && !m?.gated;
  const aside = m?.state === 'aside';
  const heroColor = aside ? 'var(--muted)' : color;
  // compte à rebours vers la prochaine clôture M5 = la prochaine DÉCISION du moteur (le desk vit entre deux bougies)
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  const left = 300_000 - (clock % 300_000);
  const scan = `${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')}`;
  return (
    <div style={{ padding: '7px 12px 0', borderBottom: '1px solid var(--border)', background: aside ? 'transparent' : `color-mix(in srgb, ${heroColor} 6%, transparent)` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, color: heroColor }}>{glyph(m)}</span>
        <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: 0.4, color: heroColor }}>{STATE_WORD[m?.state] ?? 'STANDING ASIDE'}</span>
        {m?.gated && <span style={{ fontSize: 8.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4, color: 'var(--gold)', border: '1px solid rgba(245,194,74,.35)', background: 'rgba(245,194,74,.08)' }} title="setup vu mais bloqué par le filtre de tendance EMA">⛔ trend gate</span>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 9, letterSpacing: 0.5, color: 'var(--dim)' }}>{aside ? 'PRICE' : m?.anchorLabel ?? 'PRICE'}</span>
        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: MONO, fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>{num(aside ? m?.price : m?.anchorPrice)}</span>
        {conf != null && <span style={{ fontSize: 10, fontFamily: MONO, color: aside ? 'var(--dim)' : 'var(--muted)' }}>{Math.round(conf * 100)}%</span>}
        <span style={{ fontSize: 9.5, fontFamily: MONO, color: 'var(--dim)', borderLeft: '1px solid var(--border)', paddingLeft: 8 }} title="prochaine décision du moteur (clôture M5)">scan {scan}</span>
      </div>
      {/* mince liseré de conviction, collé au bord bas de la bande */}
      <div style={{ height: 2, borderRadius: 2, background: 'rgba(255,255,255,.05)', overflow: 'hidden', marginTop: 6 }}>
        {conf != null && <div style={{ height: '100%', width: `${Math.round(conf * 100)}%`, background: heroColor, opacity: armed ? 1 : 0.5, boxShadow: armed ? `0 0 8px ${heroColor}` : 'none', transition: 'width .6s ease' }} />}
      </div>
    </div>
  );
}

function TriggerRail({ m }: { m: any }) {
  const color = kindColor(m);
  return (
    <div style={{ background: `color-mix(in srgb, ${color} 8%, transparent)`, borderRadius: 4, padding: '3px 8px', marginTop: 2, fontSize: 11, display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, color: 'var(--dim)' }}>TRIGGER</span>
      <span style={{ color: 'var(--muted)' }}>
        {m.trigger.cond} {m.trigger.op} <b style={{ color, fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>{num(m.trigger.level)}</b>
      </span>
    </div>
  );
}

function RBar({ m }: { m: any }) {
  const rr = typeof m?.rr === 'number' && m.rr > 0 ? m.rr : 1;
  const profit = Math.min(0.82, Math.max(0.18, rr / (rr + 1))); // part visuelle du côté TP
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, fontSize: 11, fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
      <span style={{ color: 'var(--dim)' }}>ENT <b style={{ color: 'var(--text)' }}>{num(m.entry)}</b></span>
      <span style={{ color: 'var(--dim)' }}>SL <b style={{ color: 'var(--down)' }}>{num(m.sl)}</b></span>
      <span style={{ color: 'var(--dim)' }}>TP <b style={{ color: 'var(--up)' }}>{num(m.tp)}</b></span>
      <span style={{ flex: 1, display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', minWidth: 40 }} aria-label={`risk reward ${rr.toFixed(1)}`}>
        <span style={{ width: `${(1 - profit) * 100}%`, background: 'color-mix(in srgb, var(--down) 55%, transparent)' }} />
        <span style={{ width: `${profit * 100}%`, background: 'color-mix(in srgb, var(--up) 65%, transparent)' }} />
      </span>
      {typeof m?.rr === 'number' && <span style={{ fontSize: 9.5, color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px' }}>R:R {m.rr.toFixed(1)}</span>}
    </div>
  );
}

function Chips({ m }: { m: any }) {
  const chips: Array<{ label: string; tone: string }> = Array.isArray(m?.drivers) && m.drivers.length
    ? m.drivers.slice(0, 2)
    : [{ label: `ADX ${m?.adx ?? '—'}`, tone: 'neutral' }]; // fallback si pas de drivers
  const vsEma = m?.emaBias && m.emaBias !== 'flat' && m?.direction && m.direction !== 'flat' && m.emaBias !== m.direction;
  return (
    <div style={{ display: 'flex', gap: 5, marginTop: 4, flexWrap: 'nowrap', overflow: 'hidden' }}>
      {chips.map((c, i) => (
        <span key={i} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap', background: `color-mix(in srgb, ${TONE[c.tone] ?? TONE.neutral} 12%, transparent)`, color: TONE[c.tone] ?? TONE.neutral, border: `1px solid color-mix(in srgb, ${TONE[c.tone] ?? TONE.neutral} 24%, transparent)` }}>
          {c.label}
        </span>
      ))}
      {m?.gated && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap', color: 'var(--gold)', border: '1px solid rgba(245,194,74,.3)' }}>⛔ trend gate</span>}
      {vsEma && !m?.gated && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap', color: 'var(--dim)', border: '1px solid var(--border)' }}>⚠ vs EMA</span>}
    </div>
  );
}

function Card({ e, latest }: { e: any; latest: boolean }) {
  const m = e?.data ?? {};
  const color = kindColor(m);
  const conf = typeof m?.confidence === 'number' ? m.confidence : null;
  const clause = String(e?.msg ?? '').trim();
  return (
    <div
      style={{
        borderLeft: `3px solid ${color}`,
        background: latest ? 'rgba(43,227,245,.05)' : 'rgba(255,255,255,.015)',
        borderRadius: 7,
        padding: '8px 11px',
        boxShadow: latest ? '0 0 0 1px rgba(43,227,245,.22), 0 0 18px rgba(43,227,245,.10)' : undefined,
      }}
    >
      {/* ROW 1 — spine : glyph · tag · niveau · jauge · heure (l'œil retombe toujours au même endroit) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 20 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color, width: 12, textAlign: 'center' }}>{glyph(m)}</span>
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8, color }}>{tag(m)}</span>
        <span style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ fontSize: 9, color: 'var(--dim)', marginRight: 1 }}>{levelPrefix(m?.levelKind)}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{num(m?.level)}</span>
        </span>
        <span style={{ flex: 1 }} />
        {conf != null && (
          <>
            <Meter conf={conf} threshold={m?.threshold ?? 0.72} color={color} />
            <span style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: MONO }}>{Math.round(conf * 100)}%</span>
          </>
        )}
        {latest && <span className="pulse" style={{ fontSize: 9, color: 'var(--cyan)' }}>●</span>}
        <span style={{ fontSize: 9.5, color: 'var(--dim)', fontFamily: MONO }}>{hhmm(e?.ts)}</span>
      </div>

      {/* ROW 2 — clause (seule prose) : jamais un pavé, tronquée à une ligne */}
      {clause && (
        <div style={{ fontSize: 12, lineHeight: 1.35, marginTop: 3, color: latest ? 'var(--text)' : 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{clause}</div>
      )}

      {/* ROW 3 — bande structurée selon le type */}
      {m?.kind === 'opportunity' && m?.trigger && <TriggerRail m={m} />}
      {m?.kind === 'trade' && m?.entry != null && <RBar m={m} />}

      {/* ROW 4 — chips drivers (+ alerte vs EMA) */}
      {(m?.kind === 'trade' || m?.kind === 'opportunity') && <Chips m={m} />}
    </div>
  );
}

export function Desk({ items = [] }: { items?: any[] }) {
  // dédup structurel ASSOUPLI : on effondre les lectures consécutives identiques (état·niveau·direction)
  // MAIS au plus par tranche de 15 min — un marché plat re-parle quand même (le desk doit rester bavard en live).
  const key = (e: any) => {
    const m = e?.data ?? {};
    const bucket = Math.floor((e?.ts ? Date.parse(e.ts) : 0) / 900_000);
    return `${m.state}|${m.levelKind}|${Math.round(Number(m.level) || 0)}|${m.direction}|${bucket}`;
  };
  const shown: any[] = items.filter((e: any, i: number) => i === 0 || key(e) !== key(items[i - 1]));
  const hero: any = items[0]?.data;

  return (
    <section className="panel" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0, borderColor: 'rgba(43,227,245,.3)' }}>
      <div style={{ padding: '9px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, fontWeight: 600, background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>◆ ALGORIA&nbsp;AI · desk</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {hero?.session && <span style={{ fontSize: 9.5, color: 'var(--dim)', fontFamily: MONO }}>{hero.session}</span>}
          <span className="pulse" style={{ fontSize: 10.5, color: 'var(--cyan)' }}>● live</span>
        </span>
      </div>

      {hero && <StateHero m={hero} />}

      <div className="deskscroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {shown.length === 0 && <span style={{ color: 'var(--dim)', fontSize: 12 }}>ALGORIA is reading the tape… state, calls and levels appear here.</span>}
        {shown.map((e: any, i: number) => (
          <Card key={e.id ?? i} e={e} latest={i === 0} />
        ))}
      </div>
    </section>
  );
}
