'use client';
// « OÙ JE TROUVE ÇA ? » — LE PANNEAU QUI MONTRE LA FENÊTRE AU LIEU DE LA DÉCRIRE (17/09/2026)
//
// POURQUOI. Depuis qu'on code les motifs de refus (03/09), `wrong_credentials` est le premier. La cause
// est toujours la même, et elle est déjà documentée dans le tunnel : la personne saisit les identifiants
// de l'ESPACE CLIENT du broker — son email et le mot de passe du site — au lieu de ceux du COMPTE
// METATRADER. Trois avertissements existaient déjà sous les champs. Ce sont trois lignes de texte gris de
// 10,5 px : personne ne les lit, et les chiffres le disent.
//
// CE QUE ÇA CHANGE. On reproduit la fenêtre de connexion MetaTrader, celle qu'ils ont littéralement sous
// les yeux à cet instant. Un visuel se reconnaît d'un coup d'œil ; une phrase se saute. Et on nomme
// explicitement le mauvais candidat (le site du broker) au lieu d'espérer qu'ils devinent.
//
// REPLIÉ PAR DÉFAUT, ET C'EST VOULU. La majorité n'en a pas besoin et l'ouvrir d'office ajouterait du bruit
// à un formulaire déjà long. C'est le DÉCLENCHEUR qui doit être visible, pas le contenu.
//
// CES GENS-LÀ ONT DÉJÀ DÉPOSÉ LEUR ARGENT. Ils ont fait tout le parcours, ouvert le compte, viré les fonds
// — et on les perd sur un malentendu de vocabulaire, au dernier écran. Ce sont les plus chers à perdre.
import { useState, type CSSProperties } from 'react';

const box: CSSProperties = { borderRadius: 11, padding: '11px 13px', fontSize: 12, lineHeight: 1.55, display: 'flex', flexDirection: 'column', gap: 3 };
const label: CSSProperties = { fontSize: 9.5, letterSpacing: 1.3, fontWeight: 800, textTransform: 'uppercase' };
// la fausse fenêtre MetaTrader : bord net, fond plus sombre que le formulaire, police mono — elle doit se
// lire comme une CAPTURE, pas comme un bloc de plus du formulaire, sinon l'œil la traite comme du texte
const dialog: CSSProperties = { border: '1px solid rgba(130,152,190,.45)', borderRadius: 9, background: 'rgba(6,11,22,.9)', overflow: 'hidden' };
const titleBar: CSSProperties = { padding: '6px 10px', background: 'rgba(130,152,190,.14)', fontSize: 10, letterSpacing: 0.6, color: 'var(--muted)', borderBottom: '1px solid rgba(130,152,190,.3)' };
const fieldRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px' };
const fieldName: CSSProperties = { fontSize: 10.5, color: 'var(--dim)', minWidth: 62 };
const fieldBox: CSSProperties = { flex: 1, minWidth: 0, padding: '5px 8px', borderRadius: 5, border: '1px solid rgba(43,227,245,.45)', background: 'rgba(43,227,245,.07)', color: 'var(--text)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const arrow: CSSProperties = { fontSize: 10, color: 'var(--cyan)', fontWeight: 700, whiteSpace: 'nowrap' };

/** `platform` pilote le nom du terminal ET l'exemple de serveur : un membre MT4 qui lit « MT5 » doute. */
export function WhereAreMyCredentials({ platform, serverExample, t }: { platform: 'mt5' | 'mt4'; serverExample?: string | null; t: (k: string) => string }) {
  const [open, setOpen] = useState(false);
  const app = platform === 'mt4' ? 'MetaTrader 4' : 'MetaTrader 5';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ alignSelf: 'flex-start', padding: '7px 12px', borderRadius: 9, cursor: 'pointer', fontSize: 12, fontWeight: 750, letterSpacing: 0.2, textTransform: 'none',
          border: `1px solid ${open ? 'rgba(43,227,245,.5)' : 'rgba(43,227,245,.3)'}`, background: open ? 'rgba(43,227,245,.1)' : 'rgba(43,227,245,.05)', color: 'var(--cyan)' }}
      >
        {open ? `✕ ${t('ob.creds.hide')}` : `🔍 ${t('ob.creds.help')}`}
      </button>

      {open && (
        <div className="cardIn" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ ...box, border: '1px solid rgba(255,107,138,.4)', background: 'rgba(255,107,138,.07)' }}>
            <span style={{ ...label, color: '#ff8a5c' }}>✕ {t('ob.creds.wrongTitle')}</span>
            <span style={{ color: 'var(--muted)' }}>{t('ob.creds.wrongBody')}</span>
          </div>

          <div style={{ ...box, border: '1px solid rgba(31,216,176,.4)', background: 'rgba(31,216,176,.06)' }}>
            <span style={{ ...label, color: 'var(--up)' }}>✓ {t('ob.creds.rightTitle')}</span>
            <span style={{ color: 'var(--muted)' }}>{t('ob.creds.rightBody')}</span>
          </div>

          <div style={{ fontSize: 11, color: 'var(--dim)', lineHeight: 1.5 }}>{t('ob.creds.dialog')} <b style={{ color: 'var(--text)' }}>{app}</b> :</div>
          <div className="mono" style={dialog}>
            <div style={titleBar}>{app} — Login to Trade Account</div>
            <div style={fieldRow}>
              <span style={fieldName}>Login</span>
              <span style={fieldBox}>80075484</span>
              <span style={arrow}>← 1</span>
            </div>
            <div style={fieldRow}>
              <span style={fieldName}>Password</span>
              <span style={fieldBox}>••••••••</span>
              <span style={arrow}>← 2</span>
            </div>
            <div style={fieldRow}>
              <span style={fieldName}>Server</span>
              <span style={fieldBox}>{serverExample || 'RaiseGlobal-Live'}</span>
              <span style={arrow}>← 3</span>
            </div>
          </div>

          <div style={{ fontSize: 11, color: 'var(--dim)', lineHeight: 1.5 }}>💡 {t('ob.creds.already')}</div>
        </div>
      )}
    </div>
  );
}
