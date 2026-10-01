'use client';
// 🆘 « JE BLOQUE » (01/10/2026) — sur chaque écran du parcours d'inscription. 385 inscrits ont choisi un broker
// sans jamais envoyer leurs identifiants MT5 : on ne savait pas pourquoi, et eux n'osaient pas toujours écrire.
// Le membre choisit où il bloque (un tap), ajoute un mot s'il veut ; Mathieu reçoit l'alerte Telegram avec le
// contexte (étape, broker, ancienneté) et lui écrit. Rien n'est envoyé au membre automatiquement.
import { useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { tgHref } from '@/lib/telegram';
import { HELP_TOPICS, track, type HelpTopic } from '@/lib/member/funnel';

const SUPPORT_TG = 'https://t.me/mathieu_algoria';
const chip = (on: boolean): CSSProperties => ({
  textAlign: 'left', padding: '11px 13px', borderRadius: 11, cursor: 'pointer', fontSize: 13, lineHeight: 1.35,
  border: `1px solid ${on ? 'rgba(43,227,245,.7)' : 'var(--border)'}`, background: on ? 'rgba(43,227,245,.1)' : 'var(--surface)', color: 'var(--text)',
});

export function StuckHelp({ step, t }: { step: number; t: (k: string) => string }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState<HelpTopic | null>(null);
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const send = async () => {
    if (!topic) return;
    setState('sending');
    try {
      const r = await fetch('/api/member/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'help', topic, text }) });
      if (!r.ok) throw new Error(String(r.status));
      track('ob_help', step, { topic });
      setState('sent');
    } catch { setState('error'); }
  };

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); track('ob_help', step, { opened: true }); }}
        style={{ alignSelf: 'flex-end', border: 'none', background: 'transparent', color: 'var(--cyan)', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '2px 0' }}>
        {t('help.open')}
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 95, background: 'rgba(3,7,15,.74)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, borderRadius: '22px 22px 0 0', border: '1px solid rgba(43,227,245,.32)', borderBottom: 'none', background: 'linear-gradient(180deg, var(--panel-top) 0%, var(--panel-bottom) 100%)', padding: '20px 20px max(24px, env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '88dvh', overflowY: 'auto' }}>
            <span style={{ width: 40, height: 4, borderRadius: 2, background: 'rgba(130,152,190,.35)', margin: '0 auto' }} />
            {state === 'sent' ? (
              <>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 700, textAlign: 'center', lineHeight: 1.5 }}>{t('help.sent')}</p>
                <a {...tgHref(SUPPORT_TG)} rel="noreferrer" style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--cyan)' }}>{t('help.direct')} · @mathieu_algoria</a>
                <button onClick={() => setOpen(false)} style={{ padding: '12px', borderRadius: 12, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', fontWeight: 700, cursor: 'pointer' }}>OK</button>
              </>
            ) : (
              <>
                <h2 style={{ margin: 0, fontSize: 18, textAlign: 'center' }}>{t('help.title')}</h2>
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.5 }}>{t('help.sub')}</p>
                {(Object.keys(HELP_TOPICS) as HelpTopic[]).map((k) => (
                  <button key={k} type="button" onClick={() => setTopic(k)} style={chip(topic === k)}>{topic === k ? '● ' : '○ '}{t(`help.t.${k}`)}</button>
                ))}
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={400} placeholder={t('help.text')}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 11, border: '1px solid var(--border)', background: 'var(--surface-strong)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
                {state === 'error' && <p style={{ margin: 0, fontSize: 12, color: '#ff8a5c', textAlign: 'center' }}>⚠ Not sent. <a {...tgHref(SUPPORT_TG)} rel="noreferrer" style={{ color: 'var(--cyan)' }}>@mathieu_algoria</a></p>}
                <button disabled={!topic || state === 'sending'} onClick={() => void send()}
                  style={{ padding: '14px 16px', borderRadius: 13, border: 'none', cursor: topic ? 'pointer' : 'default', fontWeight: 800, letterSpacing: 0.6, fontSize: 14, color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#22c55e)', opacity: topic ? 1 : 0.45 }}>
                  {state === 'sending' ? '…' : t('help.send')}
                </button>
                <a {...tgHref(SUPPORT_TG)} rel="noreferrer" style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>{t('help.direct')} · @mathieu_algoria</a>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
