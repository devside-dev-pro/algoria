'use client';
// BOÎTES DE DIALOGUE DE L'ADMIN — remplacent window.prompt / confirm / alert (audit 03/09 : 65 appels natifs
// portaient les saisies critiques — montant du dépôt, pays, hash TRC20, motif de forçage, mot de passe MT —
// sur un admin utilisé « à 70 % sur le téléphone »). Le prompt natif d'iOS tronque le message, n'a pas de
// clavier adapté, ne pré-remplit pas toujours et perd la saisie au moindre changement d'app.
//
// MÊME CONTRAT QUE LES NATIFS, EN PROMESSE : `ask.prompt(message, default)` renvoie la chaîne ou null,
// `ask.confirm(message)` un booléen, `ask.alert(message)` se résout quand on ferme. Un appelant se convertit
// donc mécaniquement : `window.prompt(` → `await ask.prompt(`. Si l'hôte n'est pas monté (page sans
// <DialogHost />), on retombe sur le natif : un dialogue ne doit jamais rester suspendu.
//
// OPTIONS : `ask.prompt(message, '', { options })` affiche une liste de choix à la place du champ — les
// menus « tape 1-4 » n'ont plus lieu d'être. `multiline` pour un texte long (message au membre), `type:
// 'number'` ouvre le pavé numérique sur mobile, `password` masque la saisie.
import { useEffect, useRef, useState, type CSSProperties } from 'react';

export type PromptOpts = {
  options?: Array<{ value: string; label: string; hint?: string }>;
  multiline?: boolean;
  type?: 'text' | 'number' | 'password';
  placeholder?: string;
  ok?: string; // libellé du bouton de validation
  danger?: boolean; // bouton rouge (refus, off-board, ban)
};
type Req =
  | { kind: 'prompt'; message: string; def: string; opts: PromptOpts; resolve: (v: string | null) => void }
  | { kind: 'confirm'; message: string; opts: PromptOpts; resolve: (v: boolean) => void }
  | { kind: 'alert'; message: string; resolve: () => void };

let host: ((r: Req) => void) | null = null;

export const ask = {
  prompt: (message: string, def = '', opts: PromptOpts = {}): Promise<string | null> =>
    host ? new Promise((resolve) => host!({ kind: 'prompt', message, def, opts, resolve })) : Promise.resolve(window.prompt(message, def)),
  confirm: (message: string, opts: PromptOpts = {}): Promise<boolean> =>
    host ? new Promise((resolve) => host!({ kind: 'confirm', message, opts, resolve })) : Promise.resolve(window.confirm(message)),
  alert: (message: string): Promise<void> =>
    host ? new Promise((resolve) => host!({ kind: 'alert', message, resolve })) : (window.alert(message), Promise.resolve()),
};

const overlay: CSSProperties = { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(3,7,14,.62)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 0 };
const sheet: CSSProperties = { width: '100%', maxWidth: 560, maxHeight: '88vh', overflowY: 'auto', background: 'var(--panel, #0b1220)', border: '1px solid var(--border, rgba(130,152,190,.25))', borderBottom: 'none', borderRadius: '16px 16px 0 0', padding: '16px 18px 22px', boxShadow: '0 -12px 40px rgba(0,0,0,.45)', display: 'flex', flexDirection: 'column', gap: 12 };
const field: CSSProperties = { width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid var(--border, rgba(130,152,190,.35))', background: 'rgba(10,17,31,.8)', color: 'var(--text, #e8eefc)', fontSize: 15, lineHeight: 1.4, boxSizing: 'border-box' };
const btn = (primary: boolean, danger?: boolean): CSSProperties => ({
  flex: primary ? 1 : 'none', padding: '12px 16px', borderRadius: 10, fontSize: 13.5, fontWeight: 800, cursor: 'pointer', letterSpacing: 0.3,
  border: primary ? 'none' : '1px solid var(--border, rgba(130,152,190,.35))',
  color: primary ? (danger ? '#fff' : '#04121e') : 'var(--muted, #8aa0c8)',
  background: primary ? (danger ? 'linear-gradient(90deg,#ff6b8a,#e0405f)' : 'linear-gradient(90deg,#2be3f5,#2e8bf0)') : 'transparent',
});

export function DialogHost() {
  const [queue, setQueue] = useState<Req[]>([]);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const okRef = useRef<HTMLButtonElement | null>(null);
  const cur = queue[0] ?? null;

  useEffect(() => {
    host = (r) => setQueue((q) => [...q, r]);
    return () => { host = null; };
  }, []);
  useEffect(() => {
    if (!cur) return;
    setValue(cur.kind === 'prompt' ? cur.def : '');
    // focus après rendu : sur mobile le clavier s'ouvre avec le champ pré-rempli sélectionné
    const t = setTimeout(() => { const el = inputRef.current ?? okRef.current; el?.focus(); if (el && 'select' in el && typeof el.select === 'function') el.select(); }, 30);
    return () => clearTimeout(t);
  }, [cur]);

  if (!cur) return null;
  const close = () => setQueue((q) => q.slice(1));
  const cancel = () => { if (cur.kind === 'prompt') cur.resolve(null); else if (cur.kind === 'confirm') cur.resolve(false); else cur.resolve(); close(); };
  const ok = (v?: string) => { if (cur.kind === 'prompt') cur.resolve(v ?? value); else if (cur.kind === 'confirm') cur.resolve(true); else cur.resolve(); close(); };
  const opts = cur.kind === 'alert' ? {} : cur.opts;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if (e.key === 'Enter' && !(opts.multiline && !(e.metaKey || e.ctrlKey))) { e.preventDefault(); ok(); }
  };
  // message : première ligne en titre, le reste en corps — c'est ainsi que les appelants les écrivent déjà
  const [title, ...rest] = cur.message.split('\n');
  const body = rest.join('\n').trim();

  return (
    <div style={overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }} role="dialog" aria-modal="true" onKeyDown={onKey}>
      <div style={sheet}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text, #e8eefc)', lineHeight: 1.4 }}>{title}</div>
        {body && <div style={{ fontSize: 13, color: 'var(--muted, #8aa0c8)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{body}</div>}
        {cur.kind === 'prompt' && opts.options && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {opts.options.map((o) => (
              <button key={o.value} onClick={() => ok(o.value)} style={{ textAlign: 'left', padding: '11px 12px', borderRadius: 10, border: '1px solid var(--border, rgba(130,152,190,.35))', background: 'rgba(10,17,31,.6)', color: 'var(--text, #e8eefc)', fontSize: 13.5, cursor: 'pointer', lineHeight: 1.35 }}>
                {o.label}
                {o.hint && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--dim, #6b7fa6)', marginTop: 2 }}>{o.hint}</span>}
              </button>
            ))}
          </div>
        )}
        {cur.kind === 'prompt' && !opts.options && (opts.multiline
          ? <textarea ref={(el) => { inputRef.current = el; }} value={value} onChange={(e) => setValue(e.target.value)} rows={4} placeholder={opts.placeholder} style={{ ...field, resize: 'vertical', fontFamily: 'inherit' }} />
          : <input ref={(el) => { inputRef.current = el; }} value={value} onChange={(e) => setValue(e.target.value)} placeholder={opts.placeholder}
              type={opts.type === 'password' ? 'password' : 'text'} inputMode={opts.type === 'number' ? 'decimal' : undefined} autoCapitalize="off" autoCorrect="off" spellCheck={false} style={field} />
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          {cur.kind !== 'alert' && <button onClick={cancel} style={btn(false)}>CANCEL</button>}
          {!(cur.kind === 'prompt' && opts.options) && <button ref={okRef} onClick={() => ok()} style={btn(true, opts.danger)}>{cur.kind === 'alert' ? 'OK' : (opts.ok ?? (cur.kind === 'confirm' ? 'YES' : 'OK'))}</button>}
        </div>
      </div>
    </div>
  );
}
