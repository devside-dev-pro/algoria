'use client';
// ADS STUDIO · 🎬 BRIEF DESIGNER (31/10/2026) — le formulaire qui prépare le brief vidéo pour Designer Algoria :
// style (validés / aimés seulement), thème, angle du hook, durée, formats, voix, ce qu'il faut montrer, notes.
// Aperçu en direct + bouton Copier. La trame, les mots-clés, le prompt négatif, la palette, le CTA et la ligne de
// risque sont ajoutés automatiquement et ne se modifient pas ici (lib/admin/adsBrief.ts). Aucun appel IA, aucune base.
import { useMemo, useState, type CSSProperties } from 'react';
import { toast } from '@/components/admin/Dialog';
import { dimP, goldBtn, inp, secH } from '../_shared';
import {
  DURATION_MAX, DURATION_MIN, FORMATS, HOOK_ANGLES, METHOD_VERSION, MUST_SHOW, STYLES, VOICES, conceptStory, storiesFor,
  bannedIn, buildBrief, styleWarning, type HookAngle,
} from '@/lib/admin/adsBrief';

const chip = (on: boolean, col = 'var(--cyan)'): CSSProperties => ({
  border: `1px solid ${on ? col : 'var(--border)'}`, background: on ? `color-mix(in srgb, ${col} 14%, transparent)` : 'transparent',
  color: on ? col : 'var(--muted)', borderRadius: 999, padding: '4px 11px', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
});
const lab: CSSProperties = { fontSize: 10, letterSpacing: 1, color: 'var(--dim)', fontWeight: 700 };
const row: CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap' };
const FREE = '__free__';

export function AdsBriefTab() {
  const [style, setStyle] = useState(STYLES[0]?.id ?? '');
  const [themePick, setThemePick] = useState(() => (conceptStory(STYLES[0]?.id ?? '') ?? storiesFor('')[0])?.name ?? FREE);
  const [freeTheme, setFreeTheme] = useState('');
  const [hook, setHook] = useState<HookAngle>('relatable panic');
  const [dur, setDur] = useState(30);
  const [formats, setFormats] = useState<string[]>(['9:16']);
  const [voice, setVoice] = useState(VOICES[0] ?? 'Alex');
  const [must, setMust] = useState<string[]>([...MUST_SHOW]);
  const [notes, setNotes] = useState('');

  const theme = themePick === FREE ? freeTheme : themePick;
  const stories = storiesFor(style);
  // changer de style : son histoire propre devient l'histoire par défaut ; sinon on garde une histoire universelle ou libre
  const pickStyle = (id: string) => {
    setStyle(id);
    const c = conceptStory(id);
    if (c) setThemePick(c.name);
    else if (themePick !== FREE && !storiesFor(id).some((t) => t.name === themePick)) setThemePick(storiesFor(id)[0]?.name ?? FREE);
  };
  const res = useMemo(() => buildBrief({ style, theme, hook_angle: hook, duration_s: dur, formats, voice, must_show: must, notes }), [style, theme, hook, dur, formats, voice, must, notes]);
  const warn = styleWarning(STYLES.find((s) => s.id === style));
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const copy = async () => {
    if (!res.ok) return;
    try { await navigator.clipboard.writeText(res.text); toast('Brief copied ✅'); } catch { toast('⚠ Copy failed: select the text and copy it by hand', 'error'); }
  };
  const live = (v: string) => bannedIn(v);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, alignItems: 'start' }}>
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <h2 style={secH}>🎬 BRIEF FOR DESIGNER ALGORIA</h2>
        <p style={dimP}>Pick the ingredients; the brief comes out in Designer&rsquo;s exact format. Story beats, style keywords, negative prompt, palette, CTA and risk line are added automatically (method {METHOD_VERSION}).</p>

        <div style={lab}>STYLE</div>
        <div style={row}>{STYLES.map((s) => <button key={s.id} onClick={() => pickStyle(s.id)} style={chip(style === s.id)} title={s.status}>{s.name}</button>)}</div>
        {warn && <p style={{ ...dimP, color: 'var(--gold)' }}>{warn}</p>}

        <div style={lab}>STORY</div>
        <div style={row}>
          {stories.map((t) => <button key={t.name} onClick={() => setThemePick(t.name)} style={chip(themePick === t.name)} title={t.example}>{t.name}{conceptStory(style)?.name === t.name ? ' · this style' : ''}</button>)}
          <button onClick={() => setThemePick(FREE)} style={chip(themePick === FREE, 'var(--gold)')}>✏️ Free story</button>
        </div>
        {themePick === FREE
          ? <input value={freeTheme} onChange={(e) => setFreeTheme(e.target.value)} placeholder="Your story, in English" style={inp} />
          : <p style={dimP}>{stories.find((t) => t.name === themePick)?.example}</p>}

        <div style={lab}>HOOK ANGLE</div>
        <div style={row}>{HOOK_ANGLES.map((h) => <button key={h} onClick={() => setHook(h)} style={chip(hook === h)}>{h}</button>)}</div>

        <div style={lab}>DURATION · {dur} s</div>
        <input type="range" min={DURATION_MIN} max={DURATION_MAX} step={1} value={dur} onChange={(e) => setDur(Number(e.target.value))} />

        <div style={lab}>FORMATS</div>
        <div style={row}>{FORMATS.map((f) => <button key={f} onClick={() => toggle(formats, setFormats, f)} style={chip(formats.includes(f))}>{f}</button>)}</div>

        <div style={lab}>VOICE-OVER</div>
        <div style={row}>{VOICES.map((v) => <button key={v} onClick={() => setVoice(v)} style={chip(voice === v)}>{v}{v === 'Alex' ? ' (default)' : ''}</button>)}</div>

        <div style={lab}>MUST SHOW</div>
        <div style={row}>{MUST_SHOW.map((m) => <button key={m} onClick={() => toggle(must, setMust, m)} style={chip(must.includes(m))}>{m}</button>)}</div>

        <div style={lab}>NOTES (free text, English)</div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Character, setting, a line of VO, what to avoid…" style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
        {live(notes).length > 0 && <p style={{ ...dimP, color: 'var(--down)' }}>⛔ Not allowed in an ad: {live(notes).join(', ')}</p>}
      </section>

      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={secH}>👁 PREVIEW</h2>
          <button disabled={!res.ok} onClick={() => void copy()} style={{ ...goldBtn, padding: '8px 14px', fontSize: 12, opacity: res.ok ? 1 : 0.5 }}>📋 COPY BRIEF</button>
        </div>
        {res.ok
          ? <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11, lineHeight: 1.5, color: 'var(--text)', maxHeight: '70vh', overflow: 'auto' }}>{res.text}</pre>
          : <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--down)', fontSize: 12 }}>{res.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      </section>
    </div>
  );
}
