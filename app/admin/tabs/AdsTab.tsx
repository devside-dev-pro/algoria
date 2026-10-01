'use client';
// ADS STUDIO (01/10/2026) — la bibliothèque d'ads de Mathieu : « une sorte de bibliothèque d'ads avec un stock
// d'ads, là où je peux stocker tous mes scripts, idées etc. » ; « si je suis en manque de hooks je vais dans
// ma banque de hooks » ; « il faut que ce soit vraiment pratique et ergonomique ». Quatre vues :
// - LIBRARY : une fiche par ad (pôle, hook, déroulé, besoins, statut idée → à tourner → tournée → montée → en ligne) ;
// - SHOOT LIST (vue d'accueil) : « à tourner », rangées par ce qu'il faut réunir (seul avec le téléphone d'abord),
//   et « déjà tournées » avec la date ; les cartes se déplient au clic ; les cases cochées font le brief du studio ;
// - HOOKS : la banque de hooks, avec leur statut de test (winner / loser) ;
// - SHOOT : le mode tournage, un script à la fois en gros caractères, pour lire sur le téléphone pendant la prise.
// Données : /api/member/admin/ads. Bibliothèque de départ (brief de Benjamin) : lib/admin/adsSeed.ts, importée d'un clic.
import { useEffect, useMemo, useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction, type SyntheticEvent } from 'react';
import { ask, toast } from '@/components/admin/Dialog';
import { dangerBtn, dimP, goldBtn, inp, miniBtn, okBtn, secH } from '../_shared';
import {
  ANGLES, HOOK_STATUSES, HOOK_STATUS_LABEL, NEEDS, NEED_LABEL, POLES, POLE_LABEL, READINESS, STATUSES, STATUS_LABEL, readinessOf, scriptText, studioBrief,
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
  const [view, setView] = useState<View>('list');
  const [sel, setSel] = useState<Set<string>>(new Set()); // ads cochées pour le brief du studio
  const [brief, setBrief] = useState(false);
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
  const toggleSel = (id: string) => setSel((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const altsOf = (id: string) => hooks.filter((h) => h.script_id === id).map((h) => h.text);
  const ctx = { scripts: scripts ?? [], hooks, setScripts, setHooks, patchScript, patchHook, sel, toggleSel, setSel };
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
            {([['list', `🎯 Shoot list · ${count('to_shoot')} to shoot`], ['library', '📚 Library'], ['hooks', '🪝 Hooks bank'], ['shoot', '🎬 Shooting mode']] as [View, string][]).map(([k, l]) => (
              <button key={k} onClick={() => { setFocus(null); setView(k); }} style={chip(view === k)}>{l}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 6 }}>
          {STATUSES.map((s) => (
            <div key={s} style={{ padding: '7px 9px', borderRadius: 9, border: '1px solid var(--border)', borderTop: `2px solid ${STATUS_LABEL[s].col}`, minWidth: 0 }}>
              <div style={{ fontSize: 8.5, letterSpacing: 0.8, color: 'var(--dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{STATUS_LABEL[s].label}</div>
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

      {/* La barre du brief : visible dès qu'une ad est cochée, quelle que soit la vue. */}
      {sel.size > 0 && (
        <div style={{ position: 'sticky', bottom: 10, zIndex: 50, display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(43,227,245,.5)', background: 'var(--panel, #0b1220)', boxShadow: '0 8px 30px rgba(0,0,0,.45)' }}>
          <span style={{ fontSize: 12.5, color: 'var(--text)' }}><b>{sel.size}</b> ad{sel.size > 1 ? 's' : ''} selected</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setSel(new Set())} style={dangerBtn}>clear</button>
            <button onClick={() => setBrief(true)} style={{ ...okBtn, padding: '9px 16px', fontSize: 12 }}>📨 BRIEF FOR THE STUDIO</button>
          </div>
        </div>
      )}
      {brief && (
        <BriefSheet ads={scripts.filter((x) => sel.has(x.id))} altsOf={altsOf} onClose={() => setBrief(false)} />
      )}
    </div>
  );
}

type Ctx = {
  scripts: AdScript[]; hooks: AdHook[];
  setScripts: Dispatch<SetStateAction<AdScript[] | null>>; setHooks: Dispatch<SetStateAction<AdHook[]>>;
  patchScript: (id: string, p: Partial<AdScript>) => Promise<void>; patchHook: (id: string, p: Partial<AdHook>) => Promise<void>;
  sel: Set<string>; toggleSel: (id: string) => void; setSel: Dispatch<SetStateAction<Set<string>>>;
};

// ===================== LIBRARY =====================
function Library({ scripts, hooks, setScripts, setHooks, patchScript, sel, toggleSel }: Ctx) {
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
                  <input type="checkbox" checked={sel.has(x.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggleSel(x.id)} title="Add to the studio brief" style={{ marginTop: 3, width: 16, height: 16, cursor: 'pointer', flex: 'none' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
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
// « Un endroit où on peut passer une ad de à tourner à tournée, que je refasse pas les mêmes » ; « survoler les
// ads : en cliquant, ça déplie la carte, et dès que j'appuie sur le bouton, ça la replie » (Mathieu, 01/10).
// À tourner : rangées par ce qu'il faut réunir (seul avec le téléphone d'abord). Déjà tournées : avec la date.
// Les cases cochées alimentent le brief pour le studio.
function ShootList({ scripts, hooks, patchScript, onRead, sel, toggleSel, setSel }: Ctx & { onRead: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const s = q.trim().toLowerCase();
  const match = (x: AdScript) => !s || [x.title, x.hook, x.body, x.prep].some((t) => t?.toLowerCase().includes(s));
  const todo = scripts.filter((x) => x.status === 'to_shoot' && match(x));
  const done = scripts.filter((x) => (x.status === 'shot' || x.status === 'edited' || x.status === 'live') && match(x))
    .sort((a, b) => (b.shot_at ?? b.updated_at).localeCompare(a.shot_at ?? a.updated_at));
  const ideas = scripts.filter((x) => x.status === 'idea' && match(x));
  const altsOf = (id: string) => hooks.filter((h) => h.script_id === id).map((h) => h.text);
  const toggle = (id: string) => setOpen((o) => (o === id ? null : id));
  const renderCard = (x: AdScript, actions: ReactNode, accent: string) => (
    <AdCard key={x.id} x={x} alts={altsOf(x.id)} open={open === x.id} onToggle={() => toggle(x.id)}
      selected={sel.has(x.id)} onSelect={() => toggleSel(x.id)} accent={accent} actions={actions} onRead={() => onRead(x.id)} />
  );
  const shotBtn = (x: AdScript) => (
    <button onClick={() => { setOpen(null); void patchScript(x.id, { status: 'shot' }); toast(`✓ “${x.title}” shot`); }} style={{ ...okBtn, padding: '8px 14px' }}>✓ SHOT</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search an ad, a word, a prop…" style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14, alignItems: 'start' }}>
        <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ ...secH, color: 'var(--gold)' }}>🎯 TO SHOOT · {todo.length}</h2>
          {todo.length === 0 && <p style={dimP}>Nothing left to shoot. Add ideas from the list below.</p>}
          {READINESS.map((g) => {
            const items = todo.filter((x) => readinessOf(x.needs) === g.key);
            if (!items.length) return null;
            const allOn = items.every((x) => sel.has(x.id));
            return (
              <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: g.col }}>{g.label} · {items.length}</span>
                  <button onClick={() => setSel((cur) => { const n = new Set(cur); items.forEach((x) => (allOn ? n.delete(x.id) : n.add(x.id))); return n; })} style={miniBtn}>
                    {allOn ? 'unselect' : 'select all'}
                  </button>
                </div>
                {items.map((x) => renderCard(x, <>{shotBtn(x)}</>, g.col))}
              </div>
            );
          })}
          {ideas.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ ...secH, cursor: 'pointer', fontSize: 11 }}>💡 IDEAS · {ideas.length} · add them to the shoot list</summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 8 }}>
                {ideas.map((x) => renderCard(x, <button onClick={() => { setOpen(null); void patchScript(x.id, { status: 'to_shoot' }); }} style={goldBtn}>＋ to shoot</button>, 'var(--muted)'))}
              </div>
            </details>
          )}
        </section>

        <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 style={{ ...secH, color: 'var(--up)' }}>✅ ALREADY SHOT · {done.length}</h2>
          <p style={{ ...dimP, fontSize: 11 }}>Already in the box: no need to shoot these again.</p>
          {done.length === 0 && <p style={dimP}>Nothing shot yet.</p>}
          {done.map((x) => renderCard(x, (
            <>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: STATUS_LABEL[x.status].col }}>{STATUS_LABEL[x.status].label}{x.shot_at ? ` · ${day(x.shot_at)}` : ''}</span>
              {x.status === 'shot' && <button onClick={() => void patchScript(x.id, { status: 'edited' })} style={miniBtn}>→ edited</button>}
              {x.status === 'edited' && <button onClick={() => void patchScript(x.id, { status: 'live' })} style={miniBtn}>→ live</button>}
            </>
          ), STATUS_LABEL[x.status].col))}
        </section>
      </div>
      <p style={{ ...dimP, fontSize: 11 }}>Tip: tap a card to read it, tap again to fold it. Tick the boxes to build a brief for the studio. ▶ in an open card opens the big-text shooting mode.</p>
    </div>
  );
}

/** Une ad en une ligne ; un clic la déplie (tout le script), un autre la replie. Les boutons ne déplient pas. */
function AdCard({ x, alts, open, onToggle, selected, onSelect, accent, actions, onRead }: {
  x: AdScript; alts: string[]; open: boolean; onToggle: () => void; selected: boolean; onSelect: () => void;
  accent: string; actions: ReactNode; onRead?: () => void;
}) {
  const stop = (e: SyntheticEvent) => e.stopPropagation();
  const meta = [POLE_LABEL[x.pole], ...x.needs.map((n) => NEED_LABEL[n]), x.duration ? `⏱ ${x.duration}` : ''].filter(Boolean).join(' · ');
  return (
    <div onClick={onToggle} style={{ ...card, gap: 6, padding: '10px 12px', cursor: 'pointer', borderLeft: `3px solid ${accent}`, background: open ? 'var(--surface-strong)' : 'var(--surface)', outline: selected ? '1px solid rgba(43,227,245,.6)' : 'none' }}>
      <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
        <input type="checkbox" checked={selected} onClick={stop} onChange={onSelect} title="Add to the studio brief" style={{ marginTop: 3, width: 16, height: 16, cursor: 'pointer', flex: 'none' }} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <b style={{ fontSize: 13, color: 'var(--text)' }}>{open ? '▾' : '▸'} {x.title}</b>
          <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>{meta}{x.prep ? ' · 🧰 prep' : ''}{x.meta_flag ? ' · ⚠ Meta' : ''}</span>
          {!open && x.hook && (
            <span style={{ fontSize: 12, color: 'var(--gold)', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>🪝 {x.hook}</span>
          )}
        </div>
        {!open && <div onClick={stop} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>{actions}</div>}
      </div>
      {open && (
        <div onClick={stop} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '6px 2px 2px 25px', cursor: 'auto' }}>
          {x.prep && <div><div style={{ ...secH, fontSize: 10, color: 'var(--gold)' }}>🧰 TO PREPARE</div><p style={pre}>{x.prep}</p></div>}
          {x.hook && <div><div style={{ ...secH, fontSize: 10 }}>🪝 HOOK</div><p style={{ ...pre, fontSize: 14, fontWeight: 700, color: 'var(--gold)' }}>{x.hook}</p></div>}
          {x.body && <div><div style={{ ...secH, fontSize: 10 }}>SCRIPT</div><p style={pre}>{x.body}</p></div>}
          {alts.length > 0 && <div><div style={{ ...secH, fontSize: 10 }}>ALTERNATIVE HOOKS · same outfit</div>{alts.map((h) => <p key={h} style={{ ...pre, padding: '2px 0' }}>• {h}</p>)}</div>}
          {x.meta_flag && <p style={{ margin: 0, fontSize: 12, color: '#ff8a5c', lineHeight: 1.5 }}>⚠ Meta: {x.meta_flag}</p>}
          {x.notes && <p style={{ ...pre, color: 'var(--muted)' }}>📝 {x.notes}</p>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {actions}
            {onRead && <button onClick={onRead} style={goldBtn}>▶ big-text mode</button>}
            <button onClick={() => copy(scriptText(x, alts), 'Script copied')} style={miniBtn}>📋 copy</button>
            <button onClick={onToggle} style={miniBtn}>▴ fold</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ===================== BRIEF POUR LE STUDIO =====================
// Les ads cochées → un mail prêt à envoyer : besoins réunis en tête (équipe, matériel), les règles, puis chaque
// ad (à préparer, hook, script, hooks de rechange). Modifiable avant l'envoi. L'adresse du studio est retenue
// dans ce navigateur seulement.
const STUDIO_KEY = 'algoria.ads.studioEmail';
function BriefSheet({ ads, altsOf, onClose }: { ads: AdScript[]; altsOf: (id: string) => string[]; onClose: () => void }) {
  const [initial] = useState(() => studioBrief(ads, altsOf));
  const [subject, setSubject] = useState(initial.subject);
  const [text, setText] = useState(initial.text);
  const [to, setTo] = useState(() => { try { return localStorage.getItem(STUDIO_KEY) ?? ''; } catch { return ''; } });
  const saveTo = (v: string) => { setTo(v); try { localStorage.setItem(STUDIO_KEY, v); } catch { /* navigation privée */ } };
  const mailto = `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  const long = mailto.length > 7000; // au-delà, certaines apps mail coupent le texte
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `${subject.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-')}.txt`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(3,7,14,.66)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 820, maxHeight: '92vh', overflowY: 'auto', background: 'var(--panel, #0b1220)', border: '1px solid var(--border)', borderBottom: 'none', borderRadius: '16px 16px 0 0', padding: '16px 18px calc(20px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h2 style={{ ...secH, fontSize: 13 }}>📨 BRIEF FOR THE STUDIO · {ads.length} ad{ads.length > 1 ? 's' : ''}</h2>
          <button onClick={onClose} style={dangerBtn}>close</button>
        </div>
        <input value={to} onChange={(e) => saveTo(e.target.value)} placeholder="Studio email (remembered on this device)" style={inp} />
        <input value={subject} onChange={(e) => setSubject(e.target.value)} style={inp} />
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={18} style={{ ...area, fontSize: 12.5 }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => copy(`${subject}\n\n${text}`, 'Brief copied')} style={{ ...okBtn, padding: '10px 16px', fontSize: 12 }}>📋 COPY THE BRIEF</button>
          <a href={mailto} style={{ ...goldBtn, padding: '10px 16px', fontSize: 12, textDecoration: 'none' }}>✉️ OPEN IN MY MAIL APP</a>
          <button onClick={download} style={{ ...miniBtn, padding: '8px 12px', fontSize: 11 }}>⬇ download .txt</button>
        </div>
        {long && <p style={{ ...dimP, fontSize: 11, color: 'var(--gold)' }}>Long brief: if your mail app cuts it, use COPY and paste it into the mail, or attach the .txt.</p>}
      </div>
    </div>
  );
}
