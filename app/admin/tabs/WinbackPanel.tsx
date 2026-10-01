'use client';
// 🔄 WIN-BACK — les déposants partis, avec un message PRÉPARÉ par personne (01/10/2026).
// Chargé à la demande (pas dans le rafraîchissement des 30 s : il lit le track record et l'historique).
// Le serveur choisit le message selon la façon dont la personne est partie (lib/member/winback.ts →
// winbackFollowup) ; Mathieu relit, ajuste s'il veut, et clique. L'envoi passe par botDm (avec les
// boutons app / canal / Mathieu) et s'écrit comme une relance : la ligne affiche ensuite « ✓ sent ».
import { useState } from 'react';
import { ask } from '@/components/admin/Dialog';
import { miniBtn, okBtn, secH } from '../_shared';

type Item = {
  member_no: number; tg_id: number; username: string | null; name: string | null; broker: string | null;
  group: 'returned' | 'disconnected' | 'old'; exitAt: string; sentAt: string | null; botBlocked: boolean; text: string;
};
const GROUP: Record<Item['group'], { label: string; col: string }> = {
  returned: { label: 'withdrew, then came back to the app', col: 'var(--up)' },
  disconnected: { label: 'disconnected the copy themselves', col: 'var(--gold)' },
  old: { label: 'left in the 3-strategy era', col: 'var(--muted)' },
};
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

export function WinbackPanel() {
  const [list, setList] = useState<Item[] | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | 'load' | null>(null);

  const load = () => {
    setBusy('load');
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ winbackList: true }) })
      .then(async (r) => {
        const d = (await r.json()) as { list?: Item[]; error?: string };
        if (d.error) return void ask.alert(`⚠ ${d.error}`);
        setList(d.list ?? []);
        setDrafts(Object.fromEntries((d.list ?? []).map((it) => [it.tg_id, it.text])));
      })
      .finally(() => setBusy(null));
  };
  const send = (it: Item) => {
    const text = (drafts[it.tg_id] ?? '').trim();
    if (!text) return;
    setBusy(it.tg_id);
    void fetch('/api/member/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ botDm: { tg_id: it.tg_id, text, cta: true } }) })
      .then(async (r) => {
        const d = (await r.json()) as { error?: string };
        if (d.error) return void ask.alert(`⚠ ${d.error}`);
        setList((l) => (l ?? []).map((x) => (x.tg_id === it.tg_id ? { ...x, sentAt: new Date().toISOString() } : x)));
      })
      .finally(() => setBusy(null));
  };

  return (
    <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={secH}>🔄 WIN-BACK — depositors who left</h2>
        <button disabled={busy === 'load'} onClick={load} style={miniBtn}>{busy === 'load' ? 'loading…' : list ? '↻ refresh' : 'Prepare messages'}</button>
      </div>
      {list && list.length === 0 && <p style={{ margin: 0, fontSize: 12, color: 'var(--dim)' }}>Nobody to win back right now.</p>}
      {list?.map((it) => {
        const g = GROUP[it.group];
        const text = drafts[it.tg_id] ?? it.text;
        return (
          <div key={it.tg_id} style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'baseline', fontSize: 12 }}>
              <b style={{ color: 'var(--text)' }}>#{it.member_no} {it.name ?? '?'}</b>
              {it.username && <span style={{ color: 'var(--dim)' }}>@{it.username}</span>}
              {it.broker && <span className="mono" style={{ color: 'var(--muted)' }}>{it.broker}</span>}
              <span style={{ color: g.col }}>● {g.label} · {day(it.exitAt)}</span>
              {it.sentAt && <span style={{ color: 'var(--up)' }}>✓ sent {day(it.sentAt)}</span>}
            </div>
            {it.botBlocked && (
              <p style={{ margin: 0, fontSize: 11.5, color: '#ff8a5c' }}>⚠ The bot can&rsquo;t reach this person (blocked or never opened). Write from your own Telegram.</p>
            )}
            <textarea value={text} onChange={(e) => setDrafts((s) => ({ ...s, [it.tg_id]: e.target.value }))} rows={5}
              style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '9px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-strong)', color: 'var(--text)', fontSize: 12.5, lineHeight: 1.5, fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {!it.botBlocked && (
                <button disabled={busy === it.tg_id || !text.trim()} onClick={() => send(it)} style={okBtn}>
                  {busy === it.tg_id ? 'sending…' : it.sentAt ? '📤 SEND AGAIN VIA BOT' : '📤 SEND VIA BOT'}
                </button>
              )}
              {it.username && (
                <a href={`https://t.me/${it.username}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" style={{ ...miniBtn, textDecoration: 'none' }}>
                  open in my Telegram
                </a>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
