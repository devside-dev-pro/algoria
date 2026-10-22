'use client';
// 🚨 LA DÉCLARATION DE PERTE (incident du 21-22/10/2026) — voir lib/member/incident.ts. Mathieu : « il ne faut pas
// qu'ils pensent qu'ils vont être remboursés à 100 %, il faut préciser que j'essaye de trouver la meilleure des
// solutions ». Le texte le dit avant le formulaire, pas en petits caractères.
import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

type State = { affected: boolean; lot: number | null; broker: string | null; declared: { before: number; now: number; note: string; proof: boolean; at: string } | null };

const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 };
const field: CSSProperties = { padding: '11px 13px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: 'var(--text)', fontSize: 15, outline: 'none', width: '100%', boxSizing: 'border-box' };
const label: CSSProperties = { fontSize: 12.5, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 6 };
const p: CSSProperties = { margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--text)' };

export default function Incident() {
  const router = useRouter();
  const [st, setSt] = useState<State | null>(null);
  const [before, setBefore] = useState('');
  const [now, setNow] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    void fetch('/api/member/incident').then(async (r) => {
      if (r.status === 401) { router.replace('/member/login?next=/member/incident'); return; }
      const d = (await r.json()) as State;
      setSt(d);
      if (d.declared) { setBefore(String(d.declared.before)); setNow(String(d.declared.now)); setNote(d.declared.note ?? ''); }
    }).catch(() => setErr('Could not load this page, please try again.'));
  }, [router]);

  const submit = () => {
    setBusy(true); setErr(null);
    const fd = new FormData();
    fd.set('before', before); fd.set('now', now); fd.set('note', note);
    if (file) fd.set('proof', file);
    void fetch('/api/member/incident', { method: 'POST', body: fd })
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) throw new Error(d.error ?? 'Could not send, please try again.');
        setSent(true);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '22px 16px 60px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h1 style={{ margin: 0, fontSize: 21 }}>The night of 21 to 22 October</h1>
      <section style={card}>
        <p style={p}>A failure in our trading system opened far too many trades at the same time, almost all without a stop loss, and the accounts that were copying took the same trades.</p>
        <p style={p}>I want to know exactly where each of you stands, so I can look for the best possible solution for everyone.</p>
        <p style={{ ...p, color: 'var(--gold)' }}>To be fully honest with you : this is not a refund request, and I can&rsquo;t promise a full refund. I&rsquo;m doing everything I can to find the best solution, and knowing exactly what each of you lost is the first step. I&rsquo;ll come back to you personally.</p>
        <p style={{ ...p, color: 'var(--muted)' }}>Mathieu</p>
      </section>

      {!st && !err && <p style={{ ...p, color: 'var(--muted)' }}>Loading…</p>}

      {st && !st.affected && (
        <section style={card}>
          <p style={p}>Your account was not copying during the incident, so there is nothing to declare. If you think that&rsquo;s wrong, message me on Telegram (@mathieu_algoria) 🙏🏼</p>
        </section>
      )}

      {st?.affected && sent && (
        <section style={card}>
          <p style={p}>Thank you, I&rsquo;ve got your numbers. I&rsquo;ll come back to you personally 🙏🏼</p>
          <button onClick={() => setSent(false)} style={{ ...field, cursor: 'pointer', fontSize: 13, color: 'var(--muted)' }}>Change my answer</button>
        </section>
      )}

      {st?.affected && !sent && (
        <section style={card}>
          {st.declared && <p style={{ ...p, fontSize: 12.5, color: 'var(--muted)' }}>You already answered on {new Date(st.declared.at).toLocaleDateString()}. You can correct it below.</p>}
          <label style={label}>Your balance BEFORE the incident ($)
            <input inputMode="decimal" value={before} onChange={(e) => setBefore(e.target.value)} placeholder="e.g. 500" style={field} />
          </label>
          <label style={label}>Your balance NOW ($)
            <input inputMode="decimal" value={now} onChange={(e) => setNow(e.target.value)} placeholder="e.g. 0" style={field} />
          </label>
          <label style={label}>A screenshot of your account (MT5 balance or history), recommended
            <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ ...field, fontSize: 13 }} />
          </label>
          <label style={label}>Anything you want to tell me
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} style={{ ...field, fontSize: 14, resize: 'vertical' }} />
          </label>
          {err && <p style={{ ...p, color: 'var(--down)', fontSize: 13 }}>{err}</p>}
          <button disabled={busy || !before.trim() || !now.trim()} onClick={submit}
            style={{ padding: '13px 16px', borderRadius: 12, border: 'none', fontWeight: 800, fontSize: 14, cursor: 'pointer', color: '#0b0e14', background: 'linear-gradient(90deg,#ffd166,#f5a623)', opacity: busy || !before.trim() || !now.trim() ? 0.5 : 1 }}>
            {busy ? 'Sending…' : 'Send'}
          </button>
          <p style={{ ...p, fontSize: 12, color: 'var(--muted)' }}>Never send me a password. Only the balance or the history screen.</p>
        </section>
      )}
      {err && !st && <p style={{ ...p, color: 'var(--down)' }}>{err}</p>}
    </main>
  );
}
