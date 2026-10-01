'use client';
// ADS STUDIO (01/10/2026) — la bibliothèque d'ads de Mathieu : « une sorte de bibliothèque d'ads avec un stock
// d'ads, là où je peux stocker tous mes scripts, idées etc. » ; « si je suis en manque de hooks je vais dans
// ma banque de hooks ». Quatre vues :
// - LIBRARY : une fiche par ad (pôle, hook, déroulé, besoins, statut idée → à tourner → tournée → montée → en ligne) ;
// - SHOOT LIST : « à tourner » d'un côté, « déjà tournées » (avec la date) de l'autre, pour ne pas retourner la même ;
// - HOOKS : la banque de hooks, avec leur statut de test (winner / loser) ;
// - SHOOT : le mode tournage, un script à la fois en gros caractères, pour lire sur le téléphone pendant la prise.
// Données : /api/member/admin/ads. Bibliothèque de départ (brief de Benjamin) : lib/admin/adsSeed.ts, importée d'un clic.
import { useEffect, useMemo, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';
import { ask, toast } from '@/components/admin/Dialog';
import { dangerBtn, dimP, goldBtn, inp, miniBtn, okBtn, secH } from '../_shared';
import {
  ANGLES, HOOK_STATUSES, HOOK_STATUS_LABEL, NEEDS, NEED_LABEL, POLES, POLE_LABEL, STATUSES, STATUS_LABEL, scriptText,
  type AdHook, type AdScript, type HookStatus, type Need, type Pole, type Status,
} from '@/lib/admin/ads';

type View = 'library' | 'list' | 'hooks' | 'shoot';
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const api = async (body: Record<string, unknown>) => {
  const r = await fetch('/api/member/admin/ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error ?? `HTTP ${r.status}`);
  return d;
};
const copy = (text: string, what = 'Copied') => { void navigator.clipboard?.writeText(text).then(() => toast(what), () => toast('Copy failed', 'error')); };

const chip = (on: boolean, col = 'var(--cyan)'): CSSProperties => ({
  border: `1px solid ${on ? col : 'var(--border)'}`, background: on ? `color-mix(in srgb, ${col} 14%, transparent)` : 'transparent',
  color: on ? col : 'var(--muted)', borderRadius: 999, padding: '4px 11px', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
});
const card: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, padding: 13, borderRadius: 11, border: '1px solid var(--border)', background: 'var(--surface)' };
const area: CSSProperties = { ...inp, width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5, fontSize: 12.5 };
const pre: CSSProperties = { margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 12.5, lineHeight: 1.55, color: 'var(--text)' };

function StatusSelect({ value, onChange }: { value: Status; onChange: (s: Status) => void }) {
  const c = STATUS_LABEL[value].col;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Status)} onClick={(e) => e.stopPropagation()}
      style={{ ...inp, padding: '4px 8px', fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, color: c, borderColor: `color-mix(in srgb, ${c} 50%, transparent)` }}>
      {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s].label}</option>)}
    </select>
  );
}

export function AdsTab() {
  const [scripts, setScripts] = useState<AdScript[] | null>(null);
  const [hooks, setHooks] = useState<AdHook[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<View>('library');
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<string | null>(null); // ad ouverte dans le mode tournage depuis la SHOOT LIST

  const load = async () => {
    setErr(null);
    const r = await fetch('/api/member/admin/ads');
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) { setErr(d.error ?? `HTTP ${r.status}`); return; }
    setScripts(d.scripts); setHooks(d.hooks);
  };
  useEffect(() => { void load(); }, []);

  // Écritures optimistes : l'écran change tout de suite, et revient en arrière si le serveur refuse.
  const patchScript = async (id: string, patch: Partial<AdScript>) => {
    const before = scripts;
    setScripts((l) => (l ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)));
    try {
      const d = await api({ patchScript: { id, patch } });
      if (d.script) setScripts((l) => (l ?? []).map((x) => (x.id === id ? d.script : x))); // shot_at est posé par le serveur
    } catch (e) { setScripts(before); toast(`⚠ ${(e as Error).message}`, 'error'); }
  };
  const patchHook = async (id: string, patch: Partial<AdHook>) => {
    const before = hooks;
    setHooks((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    try { await api({ patchHook: { id, patch } }); } catch (e) { setHooks(before); toast(`⚠ ${(e as Error).message}`, 'error'); }
  };
  const ctx = { scripts: scripts ?? [], hooks, setScripts, setHooks, patchScript, patchHook };
  const openInShootMode = (id: string) => { setFocus(id); setView('shoot'); };

  const seed = async () => {
    setBusy(true);
    try { const d = await api({ seed: true }); setScripts(d.scripts); setHooks(d.hooks); toast(`${d.scripts.length} ads and ${d.hooks.length} hooks imported`); }
    catch (e) { toast(`⚠ ${(e as Error).message}`, 'error'); }
    finally { setBusy(false); }
  };

  if (err) return <section className="panel" style={{ padding: 16 }}><p style={{ ...dimP, color: 'var(--down)' }}>⚠ {err}</p><button onClick={() => void load()} style={miniBtn}>retry</button></section>;
  if (!scripts) return <section className="panel" style={{ padding: 16 }}><p style={dimP}>Loading the library…</p></section>;

  const count = (s: Status) => scripts.filter((x) => x.status === s).length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={secH}>🎬 ADS STUDIO · {scripts.length} ads · {hooks.length + scripts.filter((x) => x.hook).length} hooks</h2>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {([['library', '📚 Library'], ['list', `✅ Shoot list · ${count('to_shoot')} to shoot`], ['hooks', '🪝 Hooks bank'], ['shoot', '🎬 Shooting mode']] as [View, string][]).map(([k, l]) => (
              <button key={k} onClick={() => { setFocus(null); setView(k); }} style={chip(view === k)}>{l}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
          {STATUSES.map((s) => (
            <div key={s} style={{ padding: '9px 11px', borderRadius: 9, border: '1px solid var(--border)', borderTop: `2px solid ${STATUS_LABEL[s].col}` }}>
              <div style={{ fontSize: 9.5, letterSpacing: 1.2, color: 'var(--dim)' }}>{STATUS_LABEL[s].label}</div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 800, color: count(s) ? STATUS_LABEL[s].col : 'var(--dim)' }}>{count(s)}</div>
            </div>
          ))}
        </div>
        {scripts.length === 0 && (
          <div style={{ ...card, borderColor: 'rgba(245,194,74,.45)' }}>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text)', lineHeight: 1.55 }}>
              The library is empty. Import the starter library: Benjamin&rsquo;s brief (6 poles), adapted to Algoria, with the 7 Ugly Ads written out in full and a hooks bank.
            </p>
            <button disabled={busy} onClick={() => void seed()} style={{ ...goldBtn, alignSelf: 'flex-start' }}>{busy ? 'importing…' : '📥 IMPORT THE STARTER LIBRARY'}</button>
          </div>
        )}
      </section>
      {view === 'library' && <Library {...ctx} />}
      {view === 'hooks' && <HooksBank {...ctx} />}
      {view === 'list' && <ShootList {...ctx} onRead={openInShootMode} />}
      {view === 'shoot' && <ShootMode key={focus ?? 'all'} {...ctx} startId={focus} />}
    </div>
  );
}

type Ctx = {
  scripts: AdScript[]; hooks: AdHook[];
  setScripts: Dispatch<SetStateAction<AdScript[] | null>>; setHooks: Dispatch<SetStateAction<AdHook[]>>;
  patchScript: (id: string, p: Partial<AdScript>) => Promise<void>; patchHook: (id: string, p: Partial<AdHook>) => Promise<void>;
};

// ===================== LIBRARY =====================
function Library({ scripts, hooks, setScripts, setHooks, patchScript }: Ctx) {
  const [pole, setPole] = useState<Pole | 'all'>('all');
  const [status, setStatus] = useState<Status | 'all'>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return scripts.filter((x) => (pole === 'all' || x.pole === pole) && (status === 'all' || x.status === status)
      && (!s || [x.title, x.hook, x.body, x.notes, x.prep].some((t) => t?.toLowerCase().includes(s))));
  }, [scripts, pole, status, q]);

  const remove = async (x: AdScript) => {
    if (!(await ask.confirm(`Delete “${x.title}” ? Its alternative hooks stay in the hooks bank.`, { danger: true, ok: 'Delete' }))) return;
    try {
      await api({ deleteScript: x.id });
      setScripts((l) => (l ?? []).filter((y) => y.id !== x.id));
      setHooks((l) => l.map((h) => (h.script_id === x.id ? { ...h, script_id: null } : h)));
    } catch (e) { toast(`⚠ ${(e as Error).message}`, 'error'); }
  };

  return (
    <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button onClick={() => setPole('all')} style={chip(pole === 'all')}>All poles</button>
        {POLES.map((p) => <button key={p} onClick={() => setPole(p)} style={chip(pole === p)}>{POLE_LABEL[p]} · {scripts.filter((x) => x.pole === p).length}</button>)}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={status} onChange={(e) => setStatus(e.target.value as Status | 'all')} style={{ ...inp, padding: '7px 10px', fontSize: 12 }}>
          <option value="all">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s].label}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a word, a hook…" style={{ ...inp, flex: '1 1 180px', padding: '7px 10px', fontSize: 12 }} />
        <button onClick={() => setEditing('new')} style={okBtn}>＋ NEW AD</button>
      </div>

      {editing === 'new' && (
        <ScriptEditor initial={{ pole: pole === 'all' ? 'ugly' : pole, status: 'idea', needs: [] }} onCancel={() => setEditing(null)}
          onSave={async (v) => {
            const d = await api({ addScript: { ...v, source: v.source || 'Mathieu' } });
            setScripts((l) => [...(l ?? []), d.script]); setEditing(null); setOpen(d.script.id); toast('Ad saved');
          }} />
      )}

      {shown.length === 0 && <p style={dimP}>No ad matches these filters.</p>}
      {POLES.filter((p) => shown.some((x) => x.pole === p)).map((p) => (
        <div key={p} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h3 style={{ ...secH, fontSize: 11, color: 'var(--cyan)' }}>{POLE_LABEL[p]}</h3>
          {shown.filter((x) => x.pole === p).map((x) => {
            const alts = hooks.filter((h) => h.script_id === x.id);
            if (editing === x.id) return (
              <ScriptEditor key={x.id} initial={x} onCancel={() => setEditing(null)}
                onSave={async (v) => {
                  const d = await api({ patchScript: { id: x.id, patch: v } });
                  setScripts((l) => (l ?? []).map((y) => (y.id === x.id ? d.script : y))); setEditing(null); toast('Ad saved');
                }} />
            );
            const isOpen = open === x.id;
            return (
              <div key={x.id} style={{ ...card, borderLeft: `3px solid ${STATUS_LABEL[x.status].col}` }}>
                <div onClick={() => setOpen(isOpen ? null : x.id)} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', justifyContent: 'space-between', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <b style={{ fontSize: 13.5, color: 'var(--text)' }}>{isOpen ? '▾' : '▸'} {x.title}</b>
                    {x.hook && <span style={{ fontSize: 12.5, color: 'var(--gold)', lineHeight: 1.45 }}>🪝 {x.hook}</span>}
                    <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>
                      {x.needs.map((n) => NEED_LABEL[n]).join(' · ')}{x.duration ? ` · ⏱ ${x.duration}` : ''}{alts.length ? ` · +${alts.length} hooks` : ''}{x.source ? ` · ${x.source}` : ''}
                    </span>
                    {x.shot_at && <span style={{ fontSize: 11, color: 'var(--cyan)' }}>✓ shot {day(x.shot_at)}</span>}
                    {x.meta_flag && <span style={{ fontSize: 11, color: '#ff8a5c' }}>⚠ Meta risk</span>}
                  </div>
                  <StatusSelect value={x.status} onChange={(s) => void patchScript(x.id, { status: s })} />
                </div>
                {isOpen && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
                    {x.meta_flag && <p style={{ margin: 0, fontSize: 12, color: '#ff8a5c', lineHeight: 1.5 }}>⚠ Meta: {x.meta_flag}</p>}
                    {x.prep && <div><div style={{ ...secH, fontSize: 10 }}>TO PREPARE</div><p style={pre}>{x.prep}</p></div>}
                    {x.body && <div><div style={{ ...secH, fontSize: 10 }}>SCRIPT</div><p style={pre}>{x.body}</p></div>}
                    {alts.length > 0 && (
                      <div><div style={{ ...secH, fontSize: 10 }}>ALTERNATIVE HOOKS · shoot them right after, same outfit</div>
                        {alts.map((h) => (
                          <div key={h.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.5, color: 'var(--text)', padding: '3px 0' }}>
                            <span>• {h.text}</span><button onClick={() => copy(h.text, 'Hook copied')} style={miniBtn}>copy</button>
                          </div>
                        ))}
                      </div>
                    )}
                    {x.notes && <div><div style={{ ...secH, fontSize: 10 }}>NOTES</div><p style={{ ...pre, color: 'var(--muted)' }}>{x.notes}</p></div>}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button onClick={() => copy(scriptText(x, alts.map((h) => h.text)), 'Script copied')} style={okBtn}>📋 COPY SCRIPT</button>
                      <button onClick={() => setEditing(x.id)} style={goldBtn}>✏️ EDIT</button>
                      <button onClick={() => void remove(x)} style={dangerBtn}>delete</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}

type Draft = Partial<Pick<AdScript, 'pole' | 'title' | 'hook' | 'body' | 'prep' | 'needs' | 'duration' | 'status' | 'source' | 'notes' | 'meta_flag'>>;
function ScriptEditor({ initial, onSave, onCancel }: { initial: Draft; onSave: (v: Draft) => Promise<void>; onCancel: () => void }) {
  const [v, setV] = useState<Draft>({ title: '', hook: '', body: '', prep: '', duration: '', notes: '', meta_flag: '', source: '', ...initial });
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Draft>(k: K, val: Draft[K]) => setV((s) => ({ ...s, [k]: val }));
  const needs = v.needs ?? [];
  const field = (k: 'hook' | 'body' | 'prep' | 'notes' | 'meta_flag', label: string, rows: number, ph?: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ ...secH, fontSize: 10 }}>{label}</span>
      <textarea value={v[k] ?? ''} onChange={(e) => set(k, e.target.value)} rows={rows} placeholder={ph} style={area} />
    </label>
  );
  const save = async () => {
    if (!v.title?.trim()) return void toast('A title is needed', 'error');
    setSaving(true);
    try { await onSave(v); } catch (e) { toast(`⚠ ${(e as Error).message}`, 'error'); } finally { setSaving(false); }
  };
  return (
    <div style={{ ...card, borderColor: 'rgba(43,227,245,.45)' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input value={v.title ?? ''} onChange={(e) => set('title', e.target.value)} placeholder="Title of the ad" style={{ ...inp, flex: '2 1 220px' }} />
        <select value={v.pole} onChange={(e) => set('pole', e.target.value as Pole)} style={inp}>
          {POLES.map((p) => <option key={p} value={p}>{POLE_LABEL[p]}</option>)}
        </select>
        <StatusSelect value={v.status ?? 'idea'} onChange={(s) => set('status', s)} />
        <input value={v.duration ?? ''} onChange={(e) => set('duration', e.target.value)} placeholder="Duration (30 s)" style={{ ...inp, flex: '0 1 130px' }} />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {NEEDS.map((n) => (
          <button key={n} onClick={() => set('needs', needs.includes(n) ? needs.filter((x) => x !== n) : [...needs, n as Need])} style={chip(needs.includes(n), 'var(--gold)')}>{NEED_LABEL[n]}</button>
        ))}
      </div>
      {field('hook', 'HOOK · the first 3 seconds', 2, '"Only got 200 dollars ? You can still start."')}
      {field('prep', 'TO PREPARE', 2)}
      {field('body', 'SCRIPT · shots, lines, ending', 8)}
      {field('notes', 'NOTES', 2)}
      {field('meta_flag', 'META RISK (leave empty if none)', 2)}
      <input value={v.source ?? ''} onChange={(e) => set('source', e.target.value)} placeholder="Source (Mathieu, Benjamin…)" style={{ ...inp, fontSize: 12 }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button disabled={saving} onClick={() => void save()} style={okBtn}>{saving ? 'saving…' : '✓ SAVE'}</button>
        <button onClick={onCancel} style={dangerBtn}>cancel</button>
      </div>
    </div>
  );
}

// ===================== HOOKS BANK =====================
function HooksBank({ scripts, hooks, setHooks, patchHook }: Ctx) {
  const [angle, setAngle] = useState<string>('all');
  const [st, setSt] = useState<HookStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const [text, setText] = useState('');
  const [newAngle, setNewAngle] = useState<string>('curiosity');
  const [saving, setSaving] = useState(false);
  const titleOf = useMemo(() => new Map(scripts.map((x) => [x.id, x.title])), [scripts]);

  const s = q.trim().toLowerCase();
  const shown = hooks.filter((h) => (angle === 'all' || h.angle === angle) && (st === 'all' || h.status === st) && (!s || h.text.toLowerCase().includes(s)));
  const mains = scripts.filter((x) => x.hook && (!s || x.hook.toLowerCase().includes(s)));
  const angles = [...new Set([...ANGLES, ...hooks.map((h) => h.angle).filter((a): a is string => !!a)])];

  const add = async () => {
    if (!text.trim()) return;
    setSaving(true);
    try { const d = await api({ addHook: { text, angle: newAngle } }); setHooks((l) => [...l, d.hook]); setText(''); toast('Hook added'); }
    catch (e) { toast(`⚠ ${(e as Error).message}`, 'error'); }
    finally { setSaving(false); }
  };
  const remove = async (h: AdHook) => {
    if (!(await ask.confirm(`Delete this hook ?\n\n${h.text}`, { danger: true, ok: 'Delete' }))) return;
    try { await api({ deleteHook: h.id }); setHooks((l) => l.filter((x) => x.id !== h.id)); } catch (e) { toast(`⚠ ${(e as Error).message}`, 'error'); }
  };

  return (
    <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void add(); }} placeholder="New hook idea… (Enter to save)" style={{ ...inp, flex: '1 1 260px' }} />
        <select value={newAngle} onChange={(e) => setNewAngle(e.target.value)} style={inp}>{ANGLES.map((a) => <option key={a} value={a}>{a}</option>)}</select>
        <button disabled={saving || !text.trim()} onClick={() => void add()} style={okBtn}>＋ ADD</button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button onClick={() => setAngle('all')} style={chip(angle === 'all')}>All angles</button>
        {angles.map((a) => <button key={a} onClick={() => setAngle(a)} style={chip(angle === a)}>{a} · {hooks.filter((h) => h.angle === a).length}</button>)}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setSt('all')} style={chip(st === 'all')}>All</button>
        {HOOK_STATUSES.map((x) => <button key={x} onClick={() => setSt(x)} style={chip(st === x, HOOK_STATUS_LABEL[x].col)}>{HOOK_STATUS_LABEL[x].label} · {hooks.filter((h) => h.status === x).length}</button>)}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" style={{ ...inp, flex: '1 1 160px', padding: '6px 10px', fontSize: 12 }} />
      </div>

      {shown.length === 0 && <p style={dimP}>No hook matches these filters.</p>}
      {shown.map((h) => (
        <div key={h.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 11px', borderRadius: 9, border: '1px solid var(--border)', borderLeft: `3px solid ${HOOK_STATUS_LABEL[h.status].col}`, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.45 }}>{h.text}</span>
            <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>{h.angle ?? 'no angle'}{h.script_id && titleOf.get(h.script_id) ? ` · for “${titleOf.get(h.script_id)}”` : ''}</span>
          </div>
          <select value={h.status} onChange={(e) => void patchHook(h.id, { status: e.target.value as HookStatus })}
            style={{ ...inp, padding: '4px 8px', fontSize: 10.5, fontWeight: 800, color: HOOK_STATUS_LABEL[h.status].col }}>
            {HOOK_STATUSES.map((x) => <option key={x} value={x}>{HOOK_STATUS_LABEL[x].label}</option>)}
          </select>
          <button onClick={() => copy(h.text, 'Hook copied')} style={okBtn}>copy</button>
          <button onClick={() => void remove(h)} style={dangerBtn}>×</button>
        </div>
      ))}

      {angle === 'all' && st === 'all' && mains.length > 0 && (
        <details>
          <summary style={{ ...secH, cursor: 'pointer', fontSize: 11 }}>MAIN HOOKS OF THE ADS ({mains.length}) · edit them in the Library</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {mains.map((x) => (
              <div key={x.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.5, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--text)', flex: '1 1 260px' }}>{x.hook} <span style={{ color: 'var(--dim)', fontSize: 10.5 }}>· {x.title}</span></span>
                <button onClick={() => copy(x.hook ?? '', 'Hook copied')} style={miniBtn}>copy</button>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

// ===================== SHOOTING MODE =====================
// Pendant la prise : un script à la fois, en gros, lisible sur le téléphone. « ✓ SHOT » le passe en « tournée ».
function ShootMode({ scripts, hooks, patchScript, startId }: Ctx & { startId: string | null }) {
  const [need, setNeed] = useState<Need | 'all'>(startId ? 'all' : 'solo');
  const [ids, setIds] = useState<string[] | null>(null);
  const [i, setI] = useState(0);
  // La liste est figée à l'ouverture (et à chaque changement de filtre) : marquer « tournée » ne la fait pas
  // sauter sous les yeux, on avance simplement à la suivante.
  useEffect(() => {
    const next = scripts.filter((x) => x.status === 'to_shoot' && (need === 'all' || x.needs.includes(need))).map((x) => x.id);
    setIds(next);
    setI(Math.max(0, startId ? next.indexOf(startId) : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [need]);
  const list = (ids ?? []).map((id) => scripts.find((x) => x.id === id)).filter((x): x is AdScript => !!x);
  const x = list[Math.min(i, list.length - 1)];
  const alts = x ? hooks.filter((h) => h.script_id === x.id) : [];

  return (
    <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--dim)' }}>Ads TO SHOOT ·</span>
        <button onClick={() => setNeed('all')} style={chip(need === 'all', 'var(--gold)')}>All</button>
        {NEEDS.map((n) => <button key={n} onClick={() => setNeed(n)} style={chip(need === n, 'var(--gold)')}>{NEED_LABEL[n]}</button>)}
      </div>
      {!x ? (
        <p style={dimP}>Nothing to shoot with this filter. Set an ad to TO SHOOT in the Library.</p>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: 12, color: 'var(--dim)' }}>{Math.min(i, list.length - 1) + 1} / {list.length} · {POLE_LABEL[x.pole]}{x.duration ? ` · ⏱ ${x.duration}` : ''}</span>
            <span style={{ fontSize: 11, fontWeight: 800, color: STATUS_LABEL[x.status].col }}>{STATUS_LABEL[x.status].label}</span>
          </div>
          <h2 style={{ margin: 0, fontSize: 22, color: 'var(--text)' }}>{x.title}</h2>
          {x.prep && <p style={{ ...pre, fontSize: 14, color: 'var(--muted)', padding: '10px 12px', borderRadius: 10, border: '1px dashed var(--border)' }}>🧰 {x.prep}</p>}
          {x.hook && <p style={{ margin: 0, fontSize: 26, lineHeight: 1.35, fontWeight: 800, color: 'var(--gold)' }}>{x.hook}</p>}
          {x.body && <p style={{ ...pre, fontSize: 19, lineHeight: 1.6 }}>{x.body}</p>}
          {alts.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(245,194,74,.35)' }}>
              <span style={{ ...secH, fontSize: 10 }}>THEN SHOOT THESE HOOKS, SAME OUTFIT</span>
              {alts.map((h) => <span key={h.id} style={{ fontSize: 18, lineHeight: 1.45, color: 'var(--text)' }}>• {h.text}</span>)}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', position: 'sticky', bottom: 8, padding: 8, borderRadius: 12, background: 'var(--panel, #0b1220)', border: '1px solid var(--border)' }}>
            <button disabled={i <= 0} onClick={() => setI((n) => Math.max(0, n - 1))} style={{ ...goldBtn, padding: '12px 16px', fontSize: 13 }}>← prev</button>
            <button onClick={() => { void patchScript(x.id, { status: 'shot' }); toast(`✓ “${x.title}” shot`); setI((n) => Math.min(n + 1, list.length - 1)); }}
              disabled={x.status !== 'to_shoot'} style={{ ...okBtn, flex: 1, padding: '12px 16px', fontSize: 13 }}>
              {x.status === 'to_shoot' ? '✓ SHOT, NEXT' : '✓ already shot'}
            </button>
            <button disabled={i >= list.length - 1} onClick={() => setI((n) => Math.min(list.length - 1, n + 1))} style={{ ...goldBtn, padding: '12px 16px', fontSize: 13 }}>next →</button>
          </div>
        </>
      )}
    </section>
  );
}

// ===================== SHOOT LIST =====================
// « Un endroit où on peut passer une ad de à tourner à tournée, que je refasse pas les mêmes » (Mathieu, 01/10).
// À gauche ce qui reste à tourner, à droite ce qui est déjà dans la boîte, avec le jour du tournage.
function ShootList({ scripts, patchScript, onRead }: Ctx & { onRead: (id: string) => void }) {
  const todo = scripts.filter((x) => x.status === 'to_shoot');
  const done = scripts.filter((x) => x.status === 'shot' || x.status === 'edited' || x.status === 'live')
    .sort((a, b) => (b.shot_at ?? b.updated_at).localeCompare(a.shot_at ?? a.updated_at));
  const ideas = scripts.filter((x) => x.status === 'idea');
  const row: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', padding: '9px 11px', borderRadius: 9, border: '1px solid var(--border)', flexWrap: 'wrap' };
  const meta = (x: AdScript) => [POLE_LABEL[x.pole], ...x.needs.map((n) => NEED_LABEL[n]), x.duration ? `⏱ ${x.duration}` : ''].filter(Boolean).join(' · ');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 14, alignItems: 'start' }}>
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ ...secH, color: 'var(--gold)' }}>🎯 TO SHOOT · {todo.length}</h2>
        {todo.length === 0 && <p style={dimP}>Nothing left to shoot. Add ideas from the list below.</p>}
        {POLES.filter((p) => todo.some((x) => x.pole === p)).map((p) => (
          <div key={p} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 10.5, letterSpacing: 1, color: 'var(--cyan)', marginTop: 4 }}>{POLE_LABEL[p]}</span>
            {todo.filter((x) => x.pole === p).map((x) => (
              <div key={x.id} style={{ ...row, borderLeft: '3px solid var(--gold)' }}>
                <div style={{ flex: '1 1 180px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <b style={{ fontSize: 13, color: 'var(--text)' }}>{x.title}</b>
                  <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>{meta(x)}</span>
                </div>
                <button onClick={() => onRead(x.id)} style={goldBtn}>▶ read</button>
                <button onClick={() => { void patchScript(x.id, { status: 'shot' }); toast(`✓ “${x.title}” shot`); }} style={{ ...okBtn, padding: '8px 14px' }}>✓ SHOT</button>
              </div>
            ))}
          </div>
        ))}
        {ideas.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ ...secH, cursor: 'pointer', fontSize: 11 }}>💡 IDEAS · {ideas.length} · add to the shoot list</summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {ideas.map((x) => (
                <div key={x.id} style={row}>
                  <div style={{ flex: '1 1 180px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 12.5, color: 'var(--text)' }}>{x.title}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>{meta(x)}</span>
                  </div>
                  <button onClick={() => void patchScript(x.id, { status: 'to_shoot' })} style={goldBtn}>＋ to shoot</button>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ ...secH, color: 'var(--up)' }}>✅ ALREADY SHOT · {done.length}</h2>
        <p style={{ ...dimP, fontSize: 11 }}>Already in the box: no need to shoot these again. Move them to EDITED and LIVE in the Library.</p>
        {done.length === 0 && <p style={dimP}>Nothing shot yet.</p>}
        {done.map((x) => (
          <div key={x.id} style={{ ...row, borderLeft: `3px solid ${STATUS_LABEL[x.status].col}` }}>
            <div style={{ flex: '1 1 180px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 12.5, color: 'var(--text)' }}>{x.title}</span>
              <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>{POLE_LABEL[x.pole]}{x.shot_at ? ` · shot ${day(x.shot_at)}` : ''}</span>
            </div>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: STATUS_LABEL[x.status].col }}>{STATUS_LABEL[x.status].label}</span>
            {x.status === 'shot' && (
              <button onClick={() => void patchScript(x.id, { status: 'to_shoot' })} title="Back to the shoot list (to redo it)" style={miniBtn}>↩ undo</button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
