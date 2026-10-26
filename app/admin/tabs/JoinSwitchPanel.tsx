'use client';
// 🚪 ACCEPTATION AUTOMATIQUE DES DEMANDES D'ADHÉSION AU CANAL PUBLIC (26/10/2026). Mathieu : « on fait des échanges de
// pubs, on doit pouvoir compter les demandes précisément… ajoute-moi une option où je peux activer et désactiver ». Coupée,
// les demandes restent en attente dans Telegram (le runner ne les accepte plus, voir runner/index.ts) et ce panneau les
// compte par lien d'invitation depuis la coupure. Le VIP garde son propre interrupteur.
import { useCallback, useEffect, useState } from 'react';
import { ask } from '@/components/admin/Dialog';
import { dangerBtn, dimP, miniBtn, okBtn, secH } from '../_shared';

type State = { on: boolean; changedAt: string | null; since: string; total: number; waiting: number; links: Array<{ link: string; requests: number; waiting: number }> };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

export function JoinSwitchPanel() {
  const [st, setSt] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const call = useCallback(async (channelAutojoin: 'get' | 'on' | 'off') => {
    setBusy(true);
    try {
      const r = await fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelAutojoin }) });
      const d = await r.json();
      if (d.error) void ask.alert(`⚠ ${d.error}`); else setSt(d as State);
    } finally { setBusy(false); }
  }, []);
  useEffect(() => { void call('get'); }, [call]);

  const turn = async (on: boolean) => {
    const msg = on
      ? `Turn auto-accept back ON? The ${st?.waiting ?? 0} request(s) waiting will all be accepted within a minute.`
      : 'Turn auto-accept OFF? New join requests will stay pending in Telegram until you accept them or turn it back on.';
    if (await ask.confirm(msg)) void call(on ? 'on' : 'off');
  };

  return (
    <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 680 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ ...secH, flex: '1 1 auto' }}>🚪 CHANNEL JOIN REQUESTS — AUTO-ACCEPT</h2>
        <button disabled={busy} onClick={() => void call('get')} style={miniBtn}>↻</button>
      </div>
      {!st ? <p style={dimP}>Loading…</p> : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <b className="mono" style={{ fontSize: 13, color: st.on ? 'var(--up)' : 'var(--gold)' }}>{st.on ? '● ON' : '⏸ OFF'}</b>
            <span style={{ ...dimP, flex: '1 1 220px' }}>
              {st.on
                ? 'Requests to the public channel are accepted automatically, 3 minutes after they arrive.'
                : `Since ${when(st.changedAt)}: requests stay pending in Telegram, nobody is accepted automatically.`}
            </span>
            <button disabled={busy} onClick={() => void turn(!st.on)} style={st.on ? dangerBtn : okBtn}>
              {st.on ? '⏸ STOP AUTO-ACCEPT' : '▶ RESUME AUTO-ACCEPT'}
            </button>
          </div>
          <p style={dimP}>
            {st.on ? 'Last 7 days' : `Since ${when(st.since)}`}: <b style={{ color: 'var(--text)' }}>{st.total}</b> request(s)
            {!st.on && <>, <b style={{ color: 'var(--gold)' }}>{st.waiting}</b> waiting</>}. The VIP channel is not counted here.
          </p>
          {st.links.length > 0 && (
            <div className="mono" style={{ fontSize: 11.5, display: 'flex', flexDirection: 'column', gap: 3, borderTop: '1px solid var(--border)', paddingTop: 9 }}>
              {st.links.map((l) => (
                <div key={l.link} style={{ display: 'flex', gap: 10, minWidth: 0 }}>
                  <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.link}</span>
                  <b>{l.requests}</b>
                  {!st.on && <span style={{ color: 'var(--gold)', minWidth: 72, textAlign: 'right' }}>{l.waiting} waiting</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
