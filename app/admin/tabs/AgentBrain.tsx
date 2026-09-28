'use client';
// 🧠 LE CERVEAU D'ALGORIA AI (29/09/2026) — Mathieu écrit ici ce que sait l'agent (knowledge.md). Le bot Telegram
// le relit dans la minute, sans redéploiement ; les faits qui vivent dans l'app (brokers, minimum, activation,
// 30 jours) s'y ajoutent tout seuls. Chaque enregistrement archive une version : une mauvaise modification se
// défait en rechargeant la précédente puis en enregistrant.
import { useEffect, useState } from 'react';
import { dimP, inp, miniBtn, okBtn, secH } from '../_shared';

interface Version { id: number; created_at: string; created_by: string | null; size: number }
interface Doc { content: string; updated_at: string | null; updated_by: string | null; versions: Version[]; max: number }

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

export function AgentBrain() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showVersions, setShowVersions] = useState(false);

  const load = async () => {
    const r = await fetch('/api/member/admin/brain?key=knowledge');
    const d = (await r.json().catch(() => ({}))) as Partial<Doc> & { error?: string };
    if (!r.ok || d.error) { setMsg(d.error ?? `HTTP ${r.status}`); return; }
    const full = { content: d.content ?? '', updated_at: d.updated_at ?? null, updated_by: d.updated_by ?? null, versions: d.versions ?? [], max: d.max ?? 20000 };
    setDoc(full);
    setText(full.content);
  };
  useEffect(() => { void load(); }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch('/api/member/admin/brain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'knowledge', content: text }) });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok || d.error) { setMsg(`Not saved: ${d.error ?? `HTTP ${r.status}`}`); return; }
      setMsg('Saved — the bot uses it within a minute.');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const loadVersion = async (v: Version) => {
    const r = await fetch(`/api/member/admin/brain?key=knowledge&version=${v.id}`);
    const d = (await r.json().catch(() => ({}))) as { version?: { content: string }; error?: string };
    if (!d.version) { setMsg(d.error ?? 'version not found'); return; }
    setText(d.version.content);
    setMsg(`Version of ${when(v.created_at)} loaded in the editor — SAVE to make it the live one.`);
  };

  const dirty = doc != null && text !== doc.content;
  const max = doc?.max ?? 20000;

  return (
    <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 680 }}>
      <h2 style={secH}>🧠 ALGORIA AI — KNOWLEDGE</h2>
      <p style={dimP}>What the bot knows, in your words (French is fine: it replies in the client&rsquo;s language). It reasons from it, it never pastes it. Partner brokers, minimum deposit, activation lot and the 30-day rule come from the app automatically — no need to write them.</p>
      {doc == null ? (
        <p style={dimP}>{msg ?? 'loading…'}</p>
      ) : (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={22} spellCheck={false} aria-label="Algoria AI knowledge"
            className="mono" style={{ ...inp, fontSize: 12, lineHeight: 1.55, resize: 'vertical', width: '100%', boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button disabled={saving || !dirty || text.length > max} onClick={() => void save()} style={{ ...okBtn, opacity: saving || !dirty || text.length > max ? 0.5 : 1 }}>{saving ? '…' : '💾 SAVE'}</button>
            {dirty && <button onClick={() => setText(doc.content)} style={miniBtn}>undo changes</button>}
            <span className="mono" style={{ fontSize: 11, color: text.length > max ? '#ff8a5c' : 'var(--dim)' }}>{text.length.toLocaleString()} / {max.toLocaleString()}</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--dim)' }}>last saved {when(doc.updated_at)}{doc.updated_by ? ` · ${doc.updated_by}` : ''}</span>
          </div>
          {!doc.content.trim() && <p style={{ ...dimP, color: 'var(--gold)' }}>Empty: the bot uses its built-in facts until you save something here.</p>}
          {msg && <p style={{ ...dimP, color: msg.startsWith('Not saved') ? '#ff8a5c' : 'var(--up)' }}>{msg}</p>}
          {doc.versions.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button onClick={() => setShowVersions((v) => !v)} style={{ ...miniBtn, alignSelf: 'flex-start' }}>{showVersions ? '▾' : '▸'} {doc.versions.length} saved versions</button>
              {showVersions && doc.versions.map((v) => (
                <div key={v.id} className="mono" style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>{when(v.created_at)}</span><span style={{ color: 'var(--dim)' }}>{v.created_by ?? '—'} · {v.size.toLocaleString()} chars</span>
                  <button onClick={() => void loadVersion(v)} style={miniBtn}>load</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
