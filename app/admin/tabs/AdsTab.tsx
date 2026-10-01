'use client';
// ADS STUDIO (01/10/2026) — la bibliothèque d'ads de Mathieu : « une sorte de bibliothèque d'ads avec un stock
// d'ads, là où je peux stocker tous mes scripts, idées etc. » ; « si je suis en manque de hooks je vais dans
// ma banque de hooks » ; « il faut que ce soit vraiment pratique et ergonomique ». Quatre vues :
// - LIBRARY : une fiche par ad (pôle, hook, déroulé, besoins, statut idée → à tourner → tournée → montée → en ligne) ;
// - SHOOT LIST (vue d'accueil) : « à tourner », rangées par ce qu'il faut réunir (seul avec le téléphone d'abord),
//   et « déjà tournées » avec la date ; les cartes se déplient au clic ; les cases cochées font le brief du studio ;
// - HOOKS : la banque de hooks, avec leur statut de test (winner / loser) ;
// - SHOOT : le mode tournage, un script à la fois en gros caractères, pour lire sur le téléphone pendant la prise.
// Sur chaque ad et chaque hook : ⭐ « j'adore » ou 👎 « pas pour moi », avec la raison. Une ad rejetée sort des
// listes (archive « Rejected », restaurable) ; ces raisons servent à Claude pour apprendre ce que Mathieu tourne.
// - MEMORY : ces signaux réunis (raisons, taux de rejet par pôle, dernières notes) + le document ads_memory
//   (agent_docs, comme la mémoire du bot) : les règles que Claude suit avant d'écrire de nouvelles ads.
// - ✨ GENERATE : Claude (Opus 5.5, clé API de Mathieu) écrit des ads selon ce qu'il a sous la main ; elles arrivent
//   en IDEA, marquées 🆕 « à trier ». Voir lib/admin/adsGenerator.ts.
// Données : /api/member/admin/ads. Bibliothèque de départ (brief de Benjamin) : lib/admin/adsSeed.ts, importée d'un clic.
import { useEffect, useMemo, useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction, type SyntheticEvent } from 'react';
import { ask, toast } from '@/components/admin/Dialog';
import { dangerBtn, dimP, goldBtn, inp, miniBtn, okBtn, secH } from '../_shared';
import { AgentBrain } from './AgentBrain';
import {
  ANGLES, HOOK_STATUSES, HOOK_STATUS_LABEL, LOVE_REASONS, NEEDS, NEED_LABEL, POLES, POLE_LABEL, READINESS, REJECT_REASONS, RESOURCES, RESOURCE_KEYS, STATUSES, STATUS_LABEL,
  isUntriaged, needsAllowed, readinessOf, scriptText, studioBrief,
  type AdHook, type AdScript, type HookStatus, type Need, type Pole, type Resource, type Status, type Verdict,
} from '@/lib/admin/ads';

type View = 'library' | 'list' | 'hooks' | 'shoot' | 'memory';
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
  const [vq, setVq] = useState<VerdictAsk | null>(null); // la feuille ⭐ / 👎 ouverte
  const [gen, setGen] = useState(false); // la feuille ✨ Generate
  const [triage, setTriage] = useState(false); // Library filtrée sur les 🆕 à trier
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
  // L'avis de Mathieu (⭐ / 👎 + raisons). null efface l'avis (restaurer une ad rejetée).
  const setVerdict = async (kind: 'script' | 'hook', id: string, verdict: Verdict | null, reasons: string[] = [], note = '') => {
    const d = await api({ verdict: { kind, id, verdict, reasons, note } });
    if (!d.row) return;
    if (kind === 'script') setScripts((l) => (l ?? []).map((x) => (x.id === id ? d.row : x)));
    else setHooks((l) => l.map((x) => (x.id === id ? d.row : x)));
    if (verdict === 'rejected') setSel((cur) => { const n = new Set(cur); n.delete(id); return n; });
    toast(verdict === 'rejected' ? '👎 Removed. Noted why.' : verdict === 'loved' ? '⭐ Noted: more like this.' : '↩ Restored');
  };
  const askVerdict = (kind: 'script' | 'hook', item: { id: string; title: string } & Partial<Pick<AdScript, 'verdict' | 'verdict_reasons' | 'verdict_note'>>, verdict: Verdict) =>
    setVq({ kind, id: item.id, title: item.title, verdict, reasons: item.verdict === verdict ? item.verdict_reasons ?? [] : [], note: item.verdict === verdict ? item.verdict_note ?? '' : '' });
  const clearVerdict = (kind: 'script' | 'hook', id: string) => { void setVerdict(kind, id, null).catch((e) => toast(`⚠ ${(e as Error).message}`, 'error')); };
  const toggleSel = (id: string) => setSel((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Les ads et hooks rejetés sortent de toutes les vues (ils restent dans l'archive « Rejected »).
  const all = scripts ?? [];
  const alive = all.filter((x) => x.verdict !== 'rejected');
  const aliveHooks = hooks.filter((h) => h.verdict !== 'rejected');
  const altsOf = (id: string) => aliveHooks.filter((h) => h.script_id === id).map((h) => h.text);
  const ctx: Ctx = {
    scripts: alive, hooks: aliveHooks, setScripts, setHooks, patchScript, patchHook, sel, toggleSel, setSel, triage, setTriage,
    rejectedScripts: all.filter((x) => x.verdict === 'rejected'), rejectedHooks: hooks.filter((h) => h.verdict === 'rejected'), askVerdict, clearVerdict,
  };
  const openInShootMode = (id: string) => { setFocus(id); setView('shoot'); };

  const seed = async () => {
    setBusy(true);
    try { const d = await api({ seed: true }); setScripts(d.scripts); setHooks(d.hooks); toast(`${d.scripts.length} ads and ${d.hooks.length} hooks imported`); }
    catch (e) { toast(`⚠ ${(e as Error).message}`, 'error'); }
    finally { setBusy(false); }
  };

  if (err) return <section className="panel" style={{ padding: 16 }}><p style={{ ...dimP, color: 'var(--down)' }}>⚠ {err}</p><button onClick={() => void load()} style={miniBtn}>retry</button></section>;
  if (!scripts) return <section className="panel" style={{ padding: 16 }}><p style={dimP}>Loading the library…</p></section>;

  const count = (s: Status) => alive.filter((x) => x.status === s).length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={secH}>🎬 ADS STUDIO · {alive.length} ads · {aliveHooks.length + alive.filter((x) => x.hook).length} hooks</h2>
            <button onClick={() => setGen(true)} style={{ ...goldBtn, padding: '8px 14px', fontSize: 12 }}>✨ GENERATE ADS</button>
            {alive.some(isUntriaged) && (
              <button onClick={() => { setTriage(true); setView('library'); }} style={{ ...okBtn, padding: '6px 12px' }}>🆕 {alive.filter(isUntriaged).length} to triage</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {([['list', `🎯 Shoot list · ${count('to_shoot')} to shoot`], ['library', '📚 Library'], ['hooks', '🪝 Hooks bank'], ['shoot', '🎬 Shooting mode'], ['memory', '🧠 Memory']] as [View, string][]).map(([k, l]) => (
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
      {view === 'memory' && <AdsMemory {...ctx} />}

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
        <BriefSheet ads={alive.filter((x) => sel.has(x.id))} altsOf={altsOf} onClose={() => setBrief(false)} />
      )}
      {gen && (
        <GenerateSheet onClose={() => setGen(false)}
          onDone={(newScripts, newHooks) => {
            setScripts((l) => [...(l ?? []), ...newScripts]);
            setHooks((l) => [...l, ...newHooks]);
            setGen(false); setTriage(true); setView('library');
          }} />
      )}
      {vq && (
        <VerdictSheet ask={vq} onClose={() => setVq(null)}
          onSubmit={async (reasons, note) => { await setVerdict(vq.kind, vq.id, vq.verdict, reasons, note); setVq(null); }} />
      )}
    </div>
  );
}

type Ctx = {
  scripts: AdScript[]; hooks: AdHook[];
  setScripts: Dispatch<SetStateAction<AdScript[] | null>>; setHooks: Dispatch<SetStateAction<AdHook[]>>;
  patchScript: (id: string, p: Partial<AdScript>) => Promise<void>; patchHook: (id: string, p: Partial<AdHook>) => Promise<void>;
  sel: Set<string>; toggleSel: (id: string) => void; setSel: Dispatch<SetStateAction<Set<string>>>;
  rejectedScripts: AdScript[]; rejectedHooks: AdHook[];
  triage: boolean; setTriage: (v: boolean) => void;
  askVerdict: (kind: 'script' | 'hook', item: { id: string; title: string } & Partial<Pick<AdScript, 'verdict' | 'verdict_reasons' | 'verdict_note'>>, v: Verdict) => void;
  clearVerdict: (kind: 'script' | 'hook', id: string) => void;
};
type VerdictAsk = { kind: 'script' | 'hook'; id: string; title: string; verdict: Verdict; reasons: string[]; note: string };

// ===================== LIBRARY =====================
function Library({ scripts, hooks, setScripts, setHooks, patchScript, sel, toggleSel, rejectedScripts, askVerdict, clearVerdict, triage, setTriage }: Ctx) {
  const [pole, setPole] = useState<Pole | 'all'>('all');
  const [status, setStatus] = useState<Status | 'all'>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return scripts.filter((x) => (pole === 'all' || x.pole === pole) && (status === 'all' || x.status === status) && (!triage || isUntriaged(x))
      && (!s || [x.title, x.hook, x.body, x.notes, x.prep].some((t) => t?.toLowerCase().includes(s))));
  }, [scripts, pole, status, q, triage]);
  const nTriage = scripts.filter(isUntriaged).length;

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
        {(nTriage > 0 || triage) && <button onClick={() => setTriage(!triage)} style={chip(triage, 'var(--up)')}>🆕 To triage · {nTriage}</button>}
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
                    <b style={{ fontSize: 13.5, color: 'var(--text)' }}>{isOpen ? '▾' : '▸'} {isUntriaged(x) ? '🆕 ' : ''}{x.verdict === 'loved' ? '⭐ ' : ''}{x.title}</b>
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
                      <VerdictButtons x={x} onAsk={(v) => askVerdict('script', x, v)} onClear={() => clearVerdict('script', x.id)} />
                      <button onClick={() => void remove(x)} style={dangerBtn}>delete</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      <RejectedArchive items={rejectedScripts.map((x) => ({ id: x.id, title: x.title, sub: POLE_LABEL[x.pole], v: x }))} label="REJECTED ADS" onRestore={(id) => clearVerdict('script', id)} />
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
function HooksBank({ scripts, hooks, setHooks, patchHook, rejectedHooks, askVerdict, clearVerdict }: Ctx) {
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
            <span style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.45 }}>{h.verdict === 'loved' ? '⭐ ' : ''}{h.text}</span>
            <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>{h.angle ?? 'no angle'}{h.script_id && titleOf.get(h.script_id) ? ` · for “${titleOf.get(h.script_id)}”` : ''}</span>
          </div>
          <select value={h.status} onChange={(e) => void patchHook(h.id, { status: e.target.value as HookStatus })}
            style={{ ...inp, padding: '4px 8px', fontSize: 10.5, fontWeight: 800, color: HOOK_STATUS_LABEL[h.status].col }}>
            {HOOK_STATUSES.map((x) => <option key={x} value={x}>{HOOK_STATUS_LABEL[x].label}</option>)}
          </select>
          <button onClick={() => copy(h.text, 'Hook copied')} style={okBtn}>copy</button>
          <VerdictButtons x={h} compact onAsk={(v) => askVerdict('hook', { ...h, title: h.text }, v)} onClear={() => clearVerdict('hook', h.id)} />
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
      <RejectedArchive items={rejectedHooks.map((h) => ({ id: h.id, title: h.text, sub: h.angle ?? '', v: h }))} label="REJECTED HOOKS" onRestore={(id) => clearVerdict('hook', id)} />
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
function ShootList({ scripts, hooks, patchScript, onRead, sel, toggleSel, setSel, askVerdict, clearVerdict }: Ctx & { onRead: (id: string) => void }) {
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
      selected={sel.has(x.id)} onSelect={() => toggleSel(x.id)} accent={accent} actions={actions} onRead={() => onRead(x.id)}
      verdict={<VerdictButtons x={x} onAsk={(v) => { setOpen(null); askVerdict('script', x, v); }} onClear={() => clearVerdict('script', x.id)} />} />
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
            // ⭐ d'abord : ce que Mathieu a aimé remonte en tête de son groupe.
            const items = todo.filter((x) => readinessOf(x.needs) === g.key).sort((a, b) => Number(b.verdict === 'loved') - Number(a.verdict === 'loved'));
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
function AdCard({ x, alts, open, onToggle, selected, onSelect, accent, actions, onRead, verdict }: {
  x: AdScript; alts: string[]; open: boolean; onToggle: () => void; selected: boolean; onSelect: () => void;
  accent: string; actions: ReactNode; onRead?: () => void; verdict?: ReactNode;
}) {
  const stop = (e: SyntheticEvent) => e.stopPropagation();
  const meta = [POLE_LABEL[x.pole], ...x.needs.map((n) => NEED_LABEL[n]), x.duration ? `⏱ ${x.duration}` : ''].filter(Boolean).join(' · ');
  return (
    <div onClick={onToggle} style={{ ...card, gap: 6, padding: '10px 12px', cursor: 'pointer', borderLeft: `3px solid ${accent}`, background: open ? 'var(--surface-strong)' : 'var(--surface)', outline: selected ? '1px solid rgba(43,227,245,.6)' : 'none' }}>
      <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
        <input type="checkbox" checked={selected} onClick={stop} onChange={onSelect} title="Add to the studio brief" style={{ marginTop: 3, width: 16, height: 16, cursor: 'pointer', flex: 'none' }} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <b style={{ fontSize: 13, color: 'var(--text)' }}>{open ? '▾' : '▸'} {isUntriaged(x) ? '🆕 ' : ''}{x.verdict === 'loved' ? '⭐ ' : ''}{x.title}</b>
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
          {x.verdict === 'loved' && <p style={{ margin: 0, fontSize: 12, color: 'var(--gold)' }}>⭐ You loved it{verdictWhy(x) ? `: ${verdictWhy(x)}` : ''}</p>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {actions}
            {verdict}
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

// ===================== ⭐ / 👎 : L'AVIS DE MATHIEU =====================
const verdictWhy = (v: Pick<AdScript, 'verdict' | 'verdict_reasons' | 'verdict_note'>) => {
  const labels = v.verdict === 'rejected' ? REJECT_REASONS : LOVE_REASONS;
  return [...v.verdict_reasons.map((r) => labels[r] ?? r), v.verdict_note ?? ''].filter(Boolean).join(' · ');
};

function VerdictButtons({ x, onAsk, onClear, compact }: { x: Pick<AdScript, 'verdict'>; onAsk: (v: Verdict) => void; onClear: () => void; compact?: boolean }) {
  const loved = x.verdict === 'loved';
  return (
    <>
      <button onClick={() => (loved ? onClear() : onAsk('loved'))} title={loved ? 'Remove the star' : 'Love it: more like this'}
        style={{ ...goldBtn, ...(loved ? { background: 'rgba(245,194,74,.22)' } : {}) }}>{loved ? '★' : '☆'}{compact ? '' : loved ? ' loved' : ' love it'}</button>
      <button onClick={() => onAsk('rejected')} title="Not for me: remove it and say why" style={dangerBtn}>👎{compact ? '' : ' not for me'}</button>
    </>
  );
}

/** La feuille qui demande pourquoi : quelques raisons en un tap, et une phrase libre. */
function VerdictSheet({ ask, onSubmit, onClose }: { ask: VerdictAsk; onSubmit: (reasons: string[], note: string) => Promise<void>; onClose: () => void }) {
  const reject = ask.verdict === 'rejected';
  const options = reject ? REJECT_REASONS : LOVE_REASONS;
  const [reasons, setReasons] = useState<string[]>(ask.reasons);
  const [note, setNote] = useState(ask.note);
  const [saving, setSaving] = useState(false);
  const ok = !reject || reasons.length > 0 || note.trim().length > 0;
  const submit = async () => {
    setSaving(true);
    try { await onSubmit(reasons, note); } catch (e) { toast(`⚠ ${(e as Error).message}`, 'error'); setSaving(false); }
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 950, background: 'rgba(3,7,14,.66)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, background: 'var(--panel, #0b1220)', border: '1px solid var(--border)', borderBottom: 'none', borderRadius: '16px 16px 0 0', padding: '16px 18px calc(20px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ ...secH, fontSize: 13, color: reject ? 'rgba(255,107,138,.95)' : 'var(--gold)' }}>{reject ? '👎 NOT FOR ME' : '⭐ LOVE IT · MORE LIKE THIS'}</h2>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text)', lineHeight: 1.45 }}>{ask.title}</p>
        <p style={{ ...dimP, fontSize: 11 }}>{reject ? 'Why ? Pick one or more, or write it. This is how Claude learns what you actually shoot.' : 'What do you like about it ? Claude will write more like this.'}</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {Object.entries(options).map(([k, label]) => (
            <button key={k} onClick={() => setReasons((r) => (r.includes(k) ? r.filter((x) => x !== k) : [...r, k]))}
              style={chip(reasons.includes(k), reject ? 'rgba(255,107,138,.95)' : 'var(--gold)')}>{label}</button>
          ))}
        </div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder={reject ? 'In your words (optional): e.g. “I never show my laptop”, “too salesy for me”…' : 'In your words (optional)'} style={area} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={!ok || saving} onClick={() => void submit()} style={{ ...(reject ? dangerBtn : goldBtn), padding: '10px 16px', fontSize: 12, opacity: ok ? 1 : 0.5 }}>
            {saving ? 'saving…' : reject ? '👎 REMOVE IT' : '⭐ SAVE'}
          </button>
          <button onClick={onClose} style={{ ...miniBtn, padding: '8px 12px' }}>cancel</button>
        </div>
      </div>
    </div>
  );
}

/** L'archive des rejets : rien n'est perdu, la raison reste visible, et on restaure d'un clic. */
function RejectedArchive({ items, label, onRestore }: { items: { id: string; title: string; sub: string; v: Pick<AdScript, 'verdict' | 'verdict_reasons' | 'verdict_note' | 'verdict_at'> }[]; label: string; onRestore: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <details style={{ marginTop: 6 }}>
      <summary style={{ ...secH, cursor: 'pointer', fontSize: 11, color: 'rgba(210,150,165,.9)' }}>👎 {label} · {items.length}</summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        {items.map((it) => (
          <div key={it.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 9, border: '1px solid rgba(255,107,138,.25)', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 12.5, color: 'var(--muted)', textDecoration: 'line-through' }}>{it.title}</span>
              <span style={{ fontSize: 11, color: 'rgba(210,150,165,.9)' }}>{verdictWhy(it.v)}{it.v.verdict_at ? ` · ${day(it.v.verdict_at)}` : ''}{it.sub ? ` · ${it.sub}` : ''}</span>
            </div>
            <button onClick={() => onRestore(it.id)} style={miniBtn}>↩ restore</button>
          </div>
        ))}
      </div>
    </details>
  );
}

// ===================== 🧠 MEMORY =====================
// « Que tu comprennes pourquoi, sur 100 ads, il y en a 20 que je n'ai pas tournées, et que tu t'adaptes » (Mathieu).
// À gauche, les signaux bruts (calculés ici, rien de stocké en plus) ; à droite, ce que Claude en a tiré
// (document ads_memory, modifiable et versionné comme la mémoire du bot). Le bouton « copier le contexte »
// produit un texte court (règles + chiffres + dernières notes) : c'est ce qu'on donnera au générateur d'ads,
// plutôt que tout l'historique, pour que ça coûte peu.
type Signal = { kind: 'ad' | 'hook'; title: string; pole: string; v: Pick<AdScript, 'verdict' | 'verdict_reasons' | 'verdict_note' | 'verdict_at'> };
function AdsMemory({ scripts, hooks, rejectedScripts, rejectedHooks }: Ctx) {
  const allAds = [...scripts, ...rejectedScripts];
  const [proposing, setProposing] = useState(false);
  const [proposal, setProposal] = useState<{ text: string; changes: string[]; cost: number | null } | null>(null);
  const [brainKey, setBrainKey] = useState(0); // remonte l'éditeur après un enregistrement
  const propose = async () => {
    setProposing(true);
    try {
      const r = await fetch('/api/member/admin/ads/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memory: true }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) throw new Error(d.error ?? `HTTP ${r.status}`);
      setProposal({ text: d.proposal, changes: d.changes ?? [], cost: d.costUsd ?? null });
    } catch (e) { toast(`⚠ ${(e as Error).message}`, 'error'); } finally { setProposing(false); }
  };
  const signals: Signal[] = [
    ...allAds.filter((x) => x.verdict).map((x) => ({ kind: 'ad' as const, title: x.title, pole: POLE_LABEL[x.pole], v: x })),
    ...[...hooks, ...rejectedHooks].filter((h) => h.verdict).map((h) => ({ kind: 'hook' as const, title: h.text, pole: `hook · ${h.angle ?? ''}`, v: h })),
  ].sort((a, b) => (b.v.verdict_at ?? '').localeCompare(a.v.verdict_at ?? ''));
  const countReasons = (verdict: Verdict, labels: Record<string, string>) => {
    const c = new Map<string, number>();
    for (const s of signals) if (s.v.verdict === verdict) for (const r of s.v.verdict_reasons) c.set(r, (c.get(r) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ label: labels[k] ?? k, n }));
  };
  const rejectR = countReasons('rejected', REJECT_REASONS);
  const loveR = countReasons('loved', LOVE_REASONS);
  const done = (x: AdScript) => x.status === 'shot' || x.status === 'edited' || x.status === 'live';
  const poles = POLES.map((p) => {
    const xs = allAds.filter((x) => x.pole === p);
    return { p, total: xs.length, rejected: xs.filter((x) => x.verdict === 'rejected').length, loved: xs.filter((x) => x.verdict === 'loved').length, shot: xs.filter(done).length };
  }).filter((r) => r.total > 0);
  const nRej = signals.filter((s) => s.v.verdict === 'rejected').length;
  const nLove = signals.filter((s) => s.v.verdict === 'loved').length;

  const why = (s: Signal) => verdictWhy(s.v);
  const contextText = async () => {
    const r = await fetch('/api/member/admin/brain?key=ads_memory');
    const d = (await r.json().catch(() => ({}))) as { content?: string };
    const lines = [
      d.content?.trim() || '(no rules yet)',
      '',
      `## Signals (${new Date().toLocaleDateString('en-GB')})`,
      `- ${allAds.length} ads · ${allAds.filter(done).length} shot · ${allAds.filter((x) => x.status === 'live').length} live · ${nRej} rejected · ${nLove} loved`,
      ...poles.map((r) => `- ${r.p}: ${r.total} ads, ${r.shot} shot, ${r.rejected} rejected, ${r.loved} loved`),
      rejectR.length ? `- Reject reasons: ${rejectR.map((x) => `${x.label} ×${x.n}`).join(', ')}` : '',
      loveR.length ? `- Love reasons: ${loveR.map((x) => `${x.label} ×${x.n}`).join(', ')}` : '',
      '',
      '## Latest verdicts',
      ...signals.slice(0, 20).map((s) => `- ${s.v.verdict === 'rejected' ? '👎' : '⭐'} ${s.kind} « ${s.title.slice(0, 90)} » : ${why(s) || '(no reason)'}`),
    ];
    copy(lines.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n'), 'Context copied');
  };

  const bar = (n: number, max: number, col: string) => (
    <span style={{ display: 'inline-block', height: 6, borderRadius: 3, background: col, width: `${Math.max(6, (n / Math.max(1, max)) * 100)}%`, opacity: 0.85 }} />
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14, alignItems: 'start' }}>
      <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={secH}>📊 YOUR SIGNALS · {nRej} 👎 · {nLove} ⭐</h2>
        <p style={{ ...dimP, fontSize: 11.5 }}>Every 👎 and ⭐ you give, with its reason. Claude reads this to write ads you actually shoot.</p>
        {signals.length === 0 && <p style={dimP}>No verdict yet. Open an ad and tap ☆ love it or 👎 not for me.</p>}
        {rejectR.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ ...secH, fontSize: 10, color: 'rgba(255,107,138,.95)' }}>WHY YOU SAY NO</span>
            {rejectR.map((r) => <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 22px', gap: 8, alignItems: 'center', fontSize: 11.5, color: 'var(--text)' }}><span>{r.label}</span>{bar(r.n, rejectR[0].n, 'rgba(255,107,138,.8)')}<span className="mono">{r.n}</span></div>)}
          </div>
        )}
        {loveR.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ ...secH, fontSize: 10, color: 'var(--gold)' }}>WHAT YOU LOVE</span>
            {loveR.map((r) => <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 22px', gap: 8, alignItems: 'center', fontSize: 11.5, color: 'var(--text)' }}><span>{r.label}</span>{bar(r.n, loveR[0].n, 'var(--gold)')}<span className="mono">{r.n}</span></div>)}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ ...secH, fontSize: 10 }}>BY POLE · shot / rejected / loved</span>
          {poles.map((r) => (
            <div key={r.p} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5, color: 'var(--text)' }}>
              <span>{POLE_LABEL[r.p]}</span>
              <span className="mono" style={{ color: 'var(--dim)' }}>{r.total} ads · <span style={{ color: 'var(--cyan)' }}>{r.shot} ✓</span> · <span style={{ color: 'rgba(255,107,138,.95)' }}>{r.rejected} 👎</span> · <span style={{ color: 'var(--gold)' }}>{r.loved} ⭐</span></span>
            </div>
          ))}
        </div>
        {signals.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ ...secH, fontSize: 10 }}>LATEST VERDICTS</span>
            {signals.slice(0, 15).map((sg, i) => (
              <div key={i} style={{ fontSize: 11.5, lineHeight: 1.45, color: 'var(--text)', padding: '6px 8px', borderRadius: 8, border: `1px solid ${sg.v.verdict === 'rejected' ? 'rgba(255,107,138,.25)' : 'rgba(245,194,74,.25)'}` }}>
                <b>{sg.v.verdict === 'rejected' ? '👎' : '⭐'} {sg.title}</b>
                <div style={{ color: 'var(--muted)' }}>{why(sg) || 'no reason given'}{sg.v.verdict_at ? ` · ${day(sg.v.verdict_at)}` : ''}</div>
              </div>
            ))}
          </div>
        )}
        <button onClick={() => void contextText()} style={{ ...okBtn, alignSelf: 'flex-start' }}>📋 COPY THE CONTEXT FOR CLAUDE</button>
        <p style={{ ...dimP, fontSize: 10.5 }}>Rules + numbers + latest verdicts in a short text. Paste it when you ask Claude for new ads elsewhere; here, Claude reads it on its own.</p>
      </section>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <section className="panel" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button disabled={proposing} onClick={() => void propose()} style={{ ...goldBtn, alignSelf: 'flex-start', padding: '9px 14px', fontSize: 12 }}>
            {proposing ? '🧠 Claude is reading your verdicts… (~30 s)' : '🧠 PROPOSE A MEMORY UPDATE FROM MY VERDICTS'}
          </button>
          <p style={{ ...dimP, fontSize: 10.5 }}>Claude rereads every ⭐ / 👎 and proposes the new rules. Nothing is saved until you check and save. Costs a few cents (your API key).</p>
        </section>
        <AgentBrain key={brainKey} docKey="ads_memory" />
      </div>
      {proposal && (
        <MemoryProposalSheet proposal={proposal} onClose={() => setProposal(null)} onSaved={() => { setProposal(null); setBrainKey((k) => k + 1); }} />
      )}
    </div>
  );
}

// ===================== ✨ GENERATE =====================
// « Un sélecteur de ce qu'on a à disposition : si on a des acteurs, un caméraman, si je me filme tout seul, un ami qui
// ne parle pas bien anglais, un ordinateur… » (Mathieu). Un appel serveur = 5 ads (~1 min) : pour 10 ou 20, on
// enchaîne les appels et on affiche la progression. Ce que Mathieu a coché est retenu sur l'appareil.
const GEN_KEY = 'algoria.ads.genPrefs';
type GenUsage = { today: number; limit: number; monthUsd: number; perCall: number };
function GenerateSheet({ onClose, onDone }: { onClose: () => void; onDone: (s: AdScript[], h: AdHook[]) => void }) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(GEN_KEY) ?? '{}') as { resources?: Resource[]; extra?: string }; } catch { return {}; } })();
  const [resources, setResources] = useState<Resource[]>(saved.resources?.length ? saved.resources : ['phone']);
  const [extra, setExtra] = useState(saved.extra ?? '');
  const [poles, setPoles] = useState<Pole[]>([]);
  const [count, setCount] = useState(5);
  const [direction, setDirection] = useState('');
  const [usage, setUsage] = useState<GenUsage | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [spent, setSpent] = useState(0);
  useEffect(() => {
    void fetch('/api/member/admin/ads/generate').then(async (r) => { const d = await r.json().catch(() => null); if (d && !d.error) setUsage(d); }).catch(() => {});
  }, []);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const allowed = needsAllowed(resources);

  const run = async () => {
    try { localStorage.setItem(GEN_KEY, JSON.stringify({ resources, extra })); } catch { /* navigation privée */ }
    const per = usage?.perCall ?? 5;
    const calls = Math.ceil(count / per);
    const all: { s: AdScript[]; h: AdHook[] } = { s: [], h: [] };
    let cost = 0;
    setProgress({ done: 0, total: count });
    for (let i = 0; i < calls; i++) {
      const n = Math.min(per, count - i * per);
      try {
        const r = await fetch('/api/member/admin/ads/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ generate: { count: n, resources, extra, poles, direction } }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.error) throw new Error(d.error ?? `HTTP ${r.status}`);
        all.s.push(...d.scripts); all.h.push(...d.hooks); cost += Number(d.costUsd ?? 0);
        if (d.usage) setUsage(d.usage);
        setSpent(cost);
        setProgress({ done: all.s.length, total: count });
      } catch (e) {
        toast(`⚠ ${(e as Error).message}`, 'error');
        break;
      }
    }
    setProgress(null);
    if (all.s.length) { toast(`✨ ${all.s.length} new ads · $${cost.toFixed(2)}`); onDone(all.s, all.h); }
  };

  const busy = progress != null;
  const limitHit = usage != null && usage.today >= usage.limit;
  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(3,7,14,.66)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 680, maxHeight: '92vh', overflowY: 'auto', background: 'var(--panel, #0b1220)', border: '1px solid var(--border)', borderBottom: 'none', borderRadius: '16px 16px 0 0', padding: '16px 18px calc(20px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h2 style={{ ...secH, fontSize: 13, color: 'var(--gold)' }}>✨ GENERATE ADS · Claude Opus 5.5</h2>
          {!busy && <button onClick={onClose} style={dangerBtn}>close</button>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ ...secH, fontSize: 10 }}>WHAT DO YOU HAVE WITH YOU ?</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {RESOURCE_KEYS.map((k) => <button key={k} disabled={busy} onClick={() => setResources((r) => toggle(r, k))} style={chip(resources.includes(k), 'var(--gold)')}>{RESOURCES[k].label}</button>)}
          </div>
          <input value={extra} disabled={busy} onChange={(e) => setExtra(e.target.value)} placeholder="Anything else ? A place, props, people… (e.g. at a café, my car, my dog)" style={inp} />
          <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>Ads will only need: {allowed.map((n) => NEED_LABEL[n]).join(' · ')}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ ...secH, fontSize: 10 }}>FORMATS (optional, none = Claude picks)</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {POLES.map((p) => <button key={p} disabled={busy} onClick={() => setPoles((l) => toggle(l, p))} style={chip(poles.includes(p))}>{POLE_LABEL[p]}</button>)}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ ...secH, fontSize: 10 }}>HOW MANY ?</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {[5, 10, 20].map((n) => <button key={n} disabled={busy} onClick={() => setCount(n)} style={chip(count === n)}>{n} ads</button>)}
          </div>
        </div>

        <textarea value={direction} disabled={busy} onChange={(e) => setDirection(e.target.value)} rows={3}
          placeholder="Direction (optional): e.g. “for the Pau shoot”, “more proof, less money talk”, “answers to sceptical comments”…" style={area} />

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button disabled={busy || limitHit || resources.length === 0} onClick={() => void run()} style={{ ...goldBtn, padding: '11px 18px', fontSize: 13 }}>
            {busy ? `Writing… ${progress.done}/${progress.total}` : `✨ WRITE ${count} ADS`}
          </button>
          <span className="mono" style={{ fontSize: 11, color: 'var(--dim)' }}>
            ≈ ${(count * 0.03).toFixed(2)} · ~{Math.ceil(count / 5)} min{spent ? ` · spent $${spent.toFixed(2)}` : ''}
          </span>
        </div>
        {busy && <p style={{ ...dimP, fontSize: 11 }}>Claude is writing, 5 ads at a time (about a minute each). Keep this open.</p>}
        {usage && (
          <p style={{ ...dimP, fontSize: 10.5, color: limitHit ? '#ff8a5c' : 'var(--dim)' }}>
            Today: {usage.today}/{usage.limit} runs · This month: ${usage.monthUsd.toFixed(2)} on your API key{limitHit ? ' · daily limit reached' : ''}
          </p>
        )}
        <p style={{ ...dimP, fontSize: 10.5 }}>New ads land in the Library as 🆕 to triage. ⭐ / 👎 them with a reason: that is how the next batches get better.</p>
      </div>
    </div>
  );
}

// ===================== 🧠 PROPOSITION DE MÉMOIRE =====================
function MemoryProposalSheet({ proposal, onClose, onSaved }: { proposal: { text: string; changes: string[]; cost: number | null }; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(proposal.text);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch('/api/member/admin/brain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'ads_memory', content: text }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) throw new Error(d.error ?? `HTTP ${r.status}`);
      toast('🧠 Memory updated');
      onSaved();
    } catch (e) { toast(`⚠ ${(e as Error).message}`, 'error'); setSaving(false); }
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(3,7,14,.66)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 760, maxHeight: '92vh', overflowY: 'auto', background: 'var(--panel, #0b1220)', border: '1px solid var(--border)', borderBottom: 'none', borderRadius: '16px 16px 0 0', padding: '16px 18px calc(20px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ ...secH, fontSize: 13 }}>🧠 PROPOSED MEMORY{proposal.cost != null ? ` · $${Number(proposal.cost).toFixed(2)}` : ''}</h2>
        {proposal.changes.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ ...secH, fontSize: 10, color: 'var(--gold)' }}>WHAT CHANGES</span>
            {proposal.changes.map((c, i) => <span key={i} style={{ fontSize: 12, color: 'var(--text)' }}>• {c}</span>)}
          </div>
        )}
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={18} className="mono" style={{ ...area, fontSize: 12 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={saving} onClick={() => void save()} style={{ ...okBtn, padding: '10px 16px', fontSize: 12 }}>{saving ? 'saving…' : '💾 SAVE AS THE NEW MEMORY'}</button>
          <button onClick={onClose} style={dangerBtn}>discard</button>
        </div>
        <p style={{ ...dimP, fontSize: 10.5 }}>The previous version stays in the history (saved versions, under the editor).</p>
      </div>
    </div>
  );
}
