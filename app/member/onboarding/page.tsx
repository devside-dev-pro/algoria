'use client';
// Wizard d'adhésion en 3 étapes : broker (budget demandé D'ABORD → le partenaire recommandé pour la
// tranche prend la vedette, Raise par défaut ; minimum PAR STRATÉGIE $200/$500/$1000) → connexion MT5 (chiffrée) → profil de risque.
// Chaque étape est persistée (onboarding_step) : on peut fermer l'app et reprendre où on en était.
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMe, StrategyPicker, bestStrategyFor, LoadFailed, useUILocale, SUPPORT_TG, Check } from '../ui';
import { tgHref } from '@/lib/telegram';
import { BROKERS, PARTNER_BROKERS, selectableBrokers, type Broker } from '@/lib/member/brokers';
import { STRATEGY_MIN_DEPOSIT, MIN_ENTRY_DEPOSIT } from '@/lib/member/minimums';
import { BUDGET_BRACKETS, brokerOrderFor } from '@/lib/member/brokerSteering';

// PREUVE + RÉASSURANCE au mur du dépôt (étape 0) : c'est LÀ que 84% des inscrits se figent. On réchauffe
// le moment de l'hésitation — gains réels de la semaine (70/30, jamais de perte), les 3 peurs désamorcées,
// et la vidéo du fondateur à un clic. Données via /api/public/proof (public, caché, always-green).
function ConfidencePanel() {
  const { t } = useUILocale();
  const [week, setWeek] = useState<{ count: number; best: number } | null>(null);
  useEffect(() => {
    void fetch('/api/public/proof').then((r) => r.json()).then((d: { week?: { count: number; best: number } }) => setWeek(d.week ?? null)).catch(() => {});
  }, []);
  return (
    <section className="panel cardIn" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid rgba(43,227,245,.28)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 20 }}>⚡</span>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 750 }}>{t('ob.proof.title')}</div>
          {week && week.count > 0 && (
            <div className="mono" style={{ fontSize: 11.5, color: 'var(--up)' }}>{t('ob.proof.week')}: <b>{week.count} {t('ob.proof.wins')}</b> · {t('ob.proof.best')} <b>+${week.best}</b></div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: 11.5, color: 'var(--muted)' }}>
        <span>🔒 <b style={{ color: 'var(--text)' }}>{t('ob.proof.control')}</b> {t('ob.proof.controlEnd')}</span>
        <span>💸 <b style={{ color: 'var(--text)' }}>{t('ob.proof.withdraw')}</b></span>
        <span>🛡️ <b style={{ color: 'var(--text)' }}>{t('ob.proof.risk')}</b> {t('ob.proof.riskEnd')}</span>
      </div>
      <a href="/member/academy" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, textDecoration: 'none', fontWeight: 750, fontSize: 12.5, color: 'var(--cyan)', border: '1px solid rgba(43,227,245,.35)', background: 'rgba(43,227,245,.06)' }}>{t('ob.proof.video')}</a>
    </section>
  );
}

const FEATURED = PARTNER_BROKERS.find((b) => b.featured) ?? PARTNER_BROKERS[0];
const OTHERS = PARTNER_BROKERS.filter((b) => !b.featured);

async function post(body: Record<string, unknown>) {
  const r = await fetch('/api/member/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? 'request failed');
  return r.json();
}

export default function Onboarding() {
  const { member, rejection, declaredDeposit, loading, t } = useMe();
  const router = useRouter();
  const [step, setStep] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [login, setLogin] = useState('');
  const [brokerOther, setBrokerOther] = useState(''); // nom du broker quand il n'est pas partenaire (résidents US)
  const [server, setServer] = useState('');
  const [serverManual, setServerManual] = useState(false); // « mon serveur n'est pas listé » → saisie libre
  const [platform, setPlatform] = useState<'mt5' | 'mt4'>('mt5'); // MT5 par défaut ; le copieur STH a besoin du IsMT4
  const [password, setPassword] = useState('');
  // VÉRIFICATION : le support contrôle le compte chez le broker AVANT d'approuver — sans le nom du
  // titulaire et le dépôt déclaré, la file admin était aveugle (n'importe qui pouvait raconter n'importe quoi)
  const [fullName, setFullName] = useState('');
  const [deposit, setDeposit] = useState('');
  const [strategy, setStrategy] = useState(2); // 1=Steady · 2=Balanced (défaut) · 3=Turbo — lot copieur fixe 0.01
  // ⚠️ ce 2 est une PRÉFÉRENCE, pas la valeur envoyée : elle est ramenée dans le budget plus bas (stratChoice)
  const [brokerPick, setBrokerPick] = useState<string | null>(null); // broker cliqué (le lien ouvre un onglet, on retient le choix)
  const [showOthers, setShowOthers] = useState(false);
  // budget annoncé (étape 0) : oriente QUEL broker est mis en avant — tant que rien n'est choisi,
  // RaiseFX garde la vedette (comportement historique). Client-only : rien n'est persisté.
  const [budget, setBudget] = useState<string | null>(null);
  // POPUP CODE BONUS (ALGORIA100) : l'arme de closing, servie uniquement sur signal d'HÉSITATION —
  // 45 s plantés sur le mur du dépôt sans avoir cliqué un seul broker, au plus 1 fois / 24 h
  // (localStorage). Celui qui avance tout seul ne la voit jamais : pas besoin de sortir un bonus
  // pour quelqu'un de déjà convaincu. Hook AVANT les early-returns (règle des hooks).
  const [bonusPop, setBonusPop] = useState(false);
  // ORIGINE DU COMPTE + les deux engagements — voir le bloc « Where does this account come from? » :
  // 74% des refus de connexion venaient d'un compte ouvert avant Algoria, donc invisible côté broker.
  const [origin, setOrigin] = useState<'new' | 'existing' | null>(null);
  const [ackLink, setAckLink] = useState(false);
  const [ackFunded, setAckFunded] = useState(false);
  useEffect(() => {
    if (!member || member.status !== 'onboarding' || bonusPop) return;
    if ((step ?? member.onboarding_step) !== 0 || (brokerPick ?? member.broker) != null) return;
    try { if (Date.now() - Number(localStorage.getItem('alg_b100_at') ?? 0) < 86_400_000) return; } catch { /* localStorage indispo → tant pis, pas de popup */ }
    const t = setTimeout(() => {
      setBonusPop(true);
      try { localStorage.setItem('alg_b100_at', String(Date.now())); } catch { /* idem */ }
    }, 45_000);
    return () => clearTimeout(t);
  }, [member, step, brokerPick, bonusPop]);

  if (loading) return <Center>loading…</Center>;
  if (!member) return <LoadFailed />; // échec de chargement : une issue, jamais un « loading… » sans fin
  if (member.status !== 'onboarding') { router.replace('/member'); return <Center>redirecting…</Center>; }
  const cur = step ?? member.onboarding_step;
  // le choix broker N'EST JAMAIS verrouillé : on repart du broker déjà enregistré (fiche membre) et
  // chaque étape a un retour ← — un compte refusé peut re-choisir un autre broker au lieu de rester coincé
  const picked = brokerPick ?? member.broker ?? null;
  const brokerServers = BROKERS.find((b) => b.key === picked)?.servers ?? []; // serveurs MT5 exacts du broker choisi
  // ordre de présentation des brokers : budget annoncé → partenaire recommandé pour cette tranche
  // en tête (brokerSteering), sinon l'ordre historique (RaiseFX en vedette)
  const order = brokerOrderFor(budget);
  const ranked: Broker[] = order
    ? order.map((k) => BROKERS.find((b) => b.key === k)).filter((b): b is Broker => b != null)
    : [FEATURED, ...OTHERS];
  const lead = ranked[0] ?? FEATURED;
  const rest = ranked.slice(1);
  const othersOpen = showOthers || (picked != null && picked !== lead.key);

  // ÉTAPE 3 — la sélection ne peut JAMAIS porter sur une stratégie hors budget (12/08). `strategy` vaut 2
  // (BALANCED, min $500) par défaut : un membre à $200 arrivait donc avec un profil coché ET grisé, un
  // bouton START muet, et aucun moyen de comprendre qu'il fallait cliquer STEADY. Plusieurs adhésions
  // bloquées là. On ramène ici la valeur affichée ET envoyée dans ce que le dépôt débloque réellement.
  // Le dépôt vient du champ local (saisi à l'étape 2) ou de la fiche KYC (reprise du wizard plus tard).
  // serveur de démonstration : son nom le dit toujours (« …-Demo », « Demo-Server »). 7% des refus.
  const demoServer = /demo/i.test(server);
  // un login MetaTrader est un NUMÉRO (6-10 chiffres en base). Une adresse email ou des lettres = la
  // personne a saisi l'identifiant de son espace client broker — 1er motif de refus. On avertit seulement.
  const loginLooksWrong = login.trim().length > 0 && !/^\d{4,12}$/.test(login.trim());
  const budgetUsd = Number(deposit) > 0 ? Number(deposit) : declaredDeposit ?? undefined;
  const affordable = budgetUsd == null || budgetUsd >= (STRATEGY_MIN_DEPOSIT[strategy] ?? 500);
  const stratChoice = affordable ? strategy : bestStrategyFor(budgetUsd) ?? 0; // 0 = rien de débloqué (dépôt < $200)

  const run = (body: Record<string, unknown>, next: number | 'done') => {
    setBusy(true);
    setErr(null);
    post(body)
      .then(() => (next === 'done' ? router.replace('/member') : setStep(next)))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setBusy(false));
  };

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 19, margin: 0 }}>Activate your access</h1>
        <span className="mono" style={{ fontSize: 11, color: 'var(--dim)' }}>STEP {Math.min(cur + 1, 3)}/3</span>
      </header>
      <div style={{ display: 'flex', gap: 5 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= cur ? 'linear-gradient(90deg,#2be3f5,#2e8bf0)' : 'rgba(130,152,190,.2)' }} />
        ))}
      </div>

      {/* demande précédente REFUSÉE (vérification broker) : la raison s'affiche, on corrige, on re-soumet —
          jamais de blocage définitif (le membre qui s'est trompé — ou a tenté — garde une porte de sortie) */}
      {rejection && (
        <div className="cardIn" style={{ border: '1px solid rgba(245,194,74,.5)', background: 'rgba(245,194,74,.07)', borderRadius: 12, padding: '12px 15px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--text)' }}>
            <b>Your previous request was declined:</b> {rejection.reason}
            <br /><span style={{ color: 'var(--muted)' }}>Fix your details below and resubmit — approvals are fast when everything checks out.</span>
          </div>
        </div>
      )}

      {cur === 0 && <ConfidencePanel />}

      {cur === 0 && (
        <section className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>{t('ob.step1')}</h2>

          {/* le budget D'ABORD : la réponse choisit quel partenaire prend la vedette juste en dessous */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="mono" style={{ fontSize: 10, letterSpacing: 1.2, color: 'var(--dim)' }}>{t('ob.budget.label')}</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {BUDGET_BRACKETS.map((b) => (
                <button key={b.key} type="button" onClick={() => setBudget(budget === b.key ? null : b.key)}
                  style={{ flex: '1 1 100px', padding: '9px 6px', borderRadius: 10, cursor: 'pointer', fontWeight: 750, fontSize: 12, letterSpacing: 0.2,
                    border: `1px solid ${budget === b.key ? 'rgba(43,227,245,.55)' : 'var(--border)'}`,
                    background: budget === b.key ? 'rgba(43,227,245,.08)' : 'rgba(10,17,31,.55)',
                    color: budget === b.key ? 'var(--cyan)' : 'var(--muted)' }}>
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          {budget && (
            <span className="mono" style={{ alignSelf: 'flex-start', fontSize: 9, letterSpacing: 1.4, color: 'var(--gold)', border: '1px solid rgba(245,194,74,.4)', borderRadius: 5, padding: '2px 7px', fontWeight: 800 }}>{t('ob.budget.best')}</span>
          )}
          <p style={pMuted}>{lead.note ?? (budget ? `${lead.name} ${t('ob.broker.recoNote')}` : t('ob.broker.genericNote'))}</p>
          <a href={lead.url} target="_blank" rel="noreferrer" onClick={() => setBrokerPick(lead.key)} style={ctaGold}>{t('ob.broker.createCta')} {lead.name.toUpperCase()} {t('ob.broker.createCtaEnd')}</a>
          <div style={{ borderLeft: '3px solid var(--gold)', background: 'rgba(245,194,74,.06)', borderRadius: 8, padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p style={{ ...pMuted, margin: 0, fontSize: 12.5 }}>
              <strong style={{ color: 'var(--gold)' }}>{t('ob.min.title')}</strong> {t('ob.min.body')}
            </p>
            <p className="mono" style={{ margin: 0, fontSize: 11, color: 'var(--muted)', letterSpacing: 0.3 }}>
              🛡️ STEADY <b style={{ color: 'var(--text)' }}>$200</b> · ⚖️ BALANCED <b style={{ color: 'var(--text)' }}>$500</b> · 🔥 TURBO <b style={{ color: 'var(--text)' }}>$1,000</b>
            </p>
            <p style={{ ...pMuted, margin: 0, fontSize: 11.5, color: 'var(--dim)' }}>{t('ob.min.warn')}</p>
          </div>
          {!othersOpen ? (
            <button onClick={() => setShowOthers(true)} style={linkBtn}>{t('ob.other')}</button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="mono" style={{ fontSize: 10, letterSpacing: 1.2, color: 'var(--dim)' }}>{t('ob.othersLabel')}</span>
              {rest.map((b) => (
                <a key={b.key} href={b.url} target="_blank" rel="noreferrer" onClick={() => setBrokerPick(b.key)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 11, textDecoration: 'none', color: 'var(--text)', border: `1px solid ${picked === b.key ? 'rgba(43,227,245,.5)' : 'var(--border)'}`, background: picked === b.key ? 'rgba(43,227,245,.07)' : 'rgba(10,17,31,.55)' }}>
                  <span style={{ fontWeight: 750, fontSize: 13.5 }}>{b.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: picked === b.key ? 'var(--cyan)' : 'var(--dim)' }}>{picked === b.key ? t('ob.selected') : t('ob.openAccount')}</span>
                </a>
              ))}
            </div>
          )}
          <button disabled={busy} onClick={() => run({ action: 'broker', broker: picked ?? lead.key }, 1)} style={ctaMain}>{t('ob.ready')}</button>
        </section>
      )}

      {cur === 1 && (
        <section className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>{t('ob.step2')}</h2>
          <p style={pMuted}>{t('ob.step2.sub')} <strong style={{ color: 'var(--text)' }}>{t('ob.step2.enc')}</strong>{t('ob.step2.encEnd')}</p>

          {/* ═══ ORIGINE DU COMPTE — LE FILTRE (14/08/2026) ═══════════════════════════════════════════
              43% des demandes de connexion étaient REFUSÉES (42 sur 98 tranchées). En classant les
              motifs : 26% « compte non rattaché à Algoria » et 48% « compte introuvable / invalid
              account » — ce second motif étant très largement le premier déguisé, puisqu'un compte
              absent du dashboard broker s'écrit « invalid account ». Trois refus sur quatre viennent
              donc de la MÊME cause : la personne avait déjà un compte chez ce broker, ouvert sans
              notre lien, donc invisible côté partenaire et impossible à commissionner.
              Rien dans le formulaire ne posait la question. On la pose AVANT les identifiants, et on
              détourne le cas au lieu de le laisser devenir un refus — un refus coûte un aller-retour
              au support, et souvent le prospect. */}
          <div style={grp}>
            <span style={grpLbl}>Where does this account come from?</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {([['new', '✨ I just created it with the Algoria link'], ['existing', '🕗 I already had this account']] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setOrigin(k)}
                  style={{ flex: '1 1 150px', padding: '12px 13px', borderRadius: 11, cursor: 'pointer', textAlign: 'left', fontSize: 12.5, fontWeight: 700, lineHeight: 1.4,
                    border: `1px solid ${origin === k ? 'rgba(43,227,245,.55)' : 'var(--border)'}`,
                    background: origin === k ? 'rgba(43,227,245,.08)' : 'rgba(10,17,31,.55)',
                    color: origin === k ? 'var(--cyan)' : 'var(--muted)' }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* COMPTE PRÉEXISTANT → on ne laisse PAS soumettre. Ce compte n'est pas rattaché à Algoria :
              il ne se trouve pas dans le dashboard partenaire, la copie ne peut pas être activée, et la
              demande finirait refusée après plusieurs heures d'attente. Deux issues, tout de suite. */}
          {origin === 'existing' && (
            <div className="cardIn" style={{ border: '1px solid rgba(245,194,74,.5)', background: 'rgba(245,194,74,.07)', borderRadius: 12, padding: '14px 15px', display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>
                <b>An account opened before Algoria can&rsquo;t be connected as-is.</b> Brokers only link an account to us when it&rsquo;s created through our link — yours won&rsquo;t show up on our side, so we can&rsquo;t switch the copying on.
                <br /><span style={{ color: 'var(--muted)' }}>It&rsquo;s not lost — most brokers can re-attach an existing account, or you open a fresh one in two minutes. Message Mathieu, he sorts this out every day.</span>
              </div>
              <a {...tgHref(SUPPORT_TG)} rel="noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '13px 16px', borderRadius: 12, textDecoration: 'none', fontWeight: 800, fontSize: 13.5, color: '#04223a', background: 'linear-gradient(90deg,#f5c24a,#e0a52e)' }}>
                💬 MESSAGE MATHIEU FIRST — he&rsquo;ll check your account
              </a>
              <button onClick={() => { setOrigin(null); setStep(0); }} style={linkBtn}>← or open a new account with a partner broker</button>
            </div>
          )}

          {/* Les identifiants n'apparaissent qu'une fois l'origine déclarée : demander un mot de passe de
              trading à quelqu'un dont on va refuser le compte est le pire moment de tout le parcours. */}
          {origin === 'new' && (<>
          {/* BLOC 1 — le compte : broker → plateforme → login → serveur → mdp, dans l'ordre, au même endroit
              (plus de « revenir en arrière » pour changer le serveur). */}
          <div style={grp}>
            <span style={grpLbl}>{t('ob.yourAccount')}</span>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <label style={{ ...lbl, flex: '1 1 130px' }}>{t('ob.broker')}
                <select value={picked ?? ''} onChange={(e) => { setBrokerPick(e.target.value || null); setServer(''); setServerManual(false); }} style={inp}>
                  <option value="">{t('ob.choose')}</option>
                  {/* un broker retiré (FXCESS) n'apparaît que si c'est DÉJÀ celui du membre — sinon sa
                      fiche s'ouvrirait sur un menu vide et le premier enregistrement l'effacerait */}
                  {selectableBrokers(member?.broker).map((b) => <option key={b.key} value={b.key}>{b.name}</option>)}
                </select>
              </label>
              <label style={{ ...lbl, flex: '1 1 150px' }}>{t('ob.platform')}
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['mt5', 'mt4'] as const).map((p) => (
                    <button key={p} type="button" onClick={() => setPlatform(p)}
                      style={{ flex: 1, padding: '10px 6px', borderRadius: 10, cursor: 'pointer', fontWeight: 800, fontSize: 12.5, letterSpacing: 0.3,
                        border: `1px solid ${platform === p ? 'rgba(43,227,245,.55)' : 'var(--border)'}`, background: platform === p ? 'rgba(43,227,245,.08)' : 'rgba(10,17,31,.55)', color: platform === p ? 'var(--cyan)' : 'var(--muted)' }}>
                      {p === 'mt5' ? 'MT5' : 'MT4'}
                    </button>
                  ))}
                </div>
              </label>
            </div>
            {/* BROKER HORS PARTENAIRES : on n'a ni lien ni liste de serveurs pour lui — le membre écrit le
                nom, et le support fait la connexion au copieur à la main (le nom exact du serveur MT ne
                s'invente pas, et une faute de frappe bloquerait la copie sans message clair). */}
            {picked === 'other' && (
              <label style={lbl}>Broker name
                <input value={brokerOther} onChange={(e) => setBrokerOther(e.target.value)} placeholder="e.g. IC Markets" style={inp} />
                <span style={hint}>We&rsquo;ll connect your account by hand — someone will confirm within a few hours.</span>
              </label>
            )}
            {/* LOGIN — 1er motif de refus (48%) : identifiants invalides, presque toujours parce que la
                personne donne ceux de l'ESPACE CLIENT du broker au lieu de ceux du compte MetaTrader.
                On avertit sans bloquer : 66 des 67 comptes en base ont un login numérique, mais le 67ᵉ
                ne l'est pas — bloquer refuserait un compte parfaitement valide. */}
            <label style={lbl}>{platform === 'mt4' ? 'MT4' : 'MT5'} login<input value={login} onChange={(e) => setLogin(e.target.value)} inputMode="numeric" placeholder="12345678" style={inp} />
              <span style={hint}>{t('ob.loginHint')}</span>
              {loginLooksWrong && <span style={{ fontSize: 11.5, color: 'var(--gold)', lineHeight: 1.5, textTransform: 'none', letterSpacing: 0 }}>⚠️ {t('ob.loginWarn')}</span>}
            </label>
            <label style={lbl}>Server
              {brokerServers.length > 0 && !serverManual ? (
                <select value={server} onChange={(e) => { const v = e.target.value; if (v === '__other__') { setServerManual(true); setServer(''); } else setServer(v); }} style={inp}>
                  <option value="">{t('ob.chooseServer')}</option>
                  {brokerServers.map((s) => <option key={s} value={s}>{s}</option>)}
                  <option value="__other__">{t('ob.serverNotListed')}</option>
                </select>
              ) : (
                <input value={server} onChange={(e) => setServer(e.target.value)} placeholder={t('ob.serverType')} style={inp} />
              )}
              <span style={hint}>{t('ob.serverHint')}</span>
              {brokerServers.length > 0 && serverManual && <button type="button" onClick={() => { setServerManual(false); setServer(''); }} style={{ ...linkBtn, marginTop: 4, textAlign: 'left' }}>{t('ob.serverBack')}</button>}
            </label>
            {/* MOT DE PASSE — la cause n°1 des refus « invalid account ». L'ancien texte disait « the one
                you log in with », qui se lit « celui de mon espace client broker » : il fabriquait
                l'erreur qu'il était censé prévenir. On dit maintenant d'OÙ vient ce mot de passe (l'email
                d'ouverture du compte), ce qu'il n'est PAS (le site du broker), et comment le retrouver. */}
            <label style={lbl}>{platform === 'mt4' ? 'MT4' : 'MT5'} password<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="••••••••" style={inp} />
              <span style={{ ...hint, color: 'var(--muted)' }}>{t('ob.pwdHint')}</span>
              <span style={hint}>{t('ob.pwdLost')}</span>
            </label>
          </div>

          {/* BLOC 2 — vérification (nom + dépôt) : le support recoupe avec le broker avant d'activer la copie. */}
          <div style={grp}>
            <span style={grpLbl}>{t('ob.verif')}</span>
            <label style={lbl}>{t('ob.fullName')}<input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="John Smith" autoComplete="name" style={inp} /></label>
            <label style={lbl}>{t('ob.amount')}<input value={deposit} onChange={(e) => setDeposit(e.target.value)} inputMode="numeric" placeholder="200" style={inp} /></label>
            <span style={hint}>{t('ob.verifHint')}</span>
          </div>

          {/* SERVEUR DÉMO — 7% des refus. Un serveur de démonstration se repère à son nom, et le membre
              ne sait souvent pas qu'il en a choisi un : MT5 ouvre un compte démo par défaut. On le dit
              ici plutôt que trois heures plus tard par un refus. */}
          {demoServer && (
            <div style={{ border: '1px solid rgba(255,107,138,.4)', background: 'rgba(255,107,138,.07)', borderRadius: 11, padding: '11px 13px', fontSize: 12.5, lineHeight: 1.55, color: 'var(--text)' }}>
              ⚠️ <b>That looks like a demo server.</b> Algoria can only copy a <b>live</b> account with real funds — a demo account can&rsquo;t be connected. Pick your live server, or message us if you&rsquo;re unsure which one it is.
            </div>
          )}

          {/* LES DEUX ENGAGEMENTS — ils ne vérifient rien à eux seuls, mais ils INFORMENT (beaucoup
              ignorent que le compte doit naître de notre lien) et ils laissent une trace de ce que le
              membre a déclaré, visible à l'examen. Cases décochées par défaut, et obligatoires. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <Check checked={ackLink} onToggle={() => setAckLink((v) => !v)}>
              I created this trading account <b style={{ color: 'var(--text)' }}>through the Algoria broker link</b> — not an account I already had.
            </Check>
            <Check checked={ackFunded} onToggle={() => setAckFunded((v) => !v)}>
              I have <b style={{ color: 'var(--text)' }}>deposited real money</b> into it — it&rsquo;s a live account, not a demo.
            </Check>
          </div>

          <button disabled={busy || !picked || (picked === 'other' && brokerOther.trim().length < 2) || !login || !server || !password || fullName.trim().length < 3 || !Number(deposit) || !ackLink || !ackFunded || demoServer} onClick={() => run({ action: 'mt5', broker: picked, brokerOther: picked === 'other' ? brokerOther : undefined, platform, login, server, password, name: fullName, deposit, ackLink, ackFunded }, 2)} style={ctaMain}>
            {busy ? t('ob.checking') : t('ob.connectCta')}
          </button>
          {/* L'ATTENTE EST LONGUE ET C'EST NORMAL : on tente une vraie connexion MetaTrader, asynchrone
              côté STH — jusqu'à ~30 s. Sans cette phrase, un bouton figé une demi-minute se lit comme un
              plantage, et la personne recharge la page au milieu du contrôle. */}
          {busy && (
            <p style={{ margin: '-6px 0 0', fontSize: 11.5, color: 'var(--cyan)', textAlign: 'center', lineHeight: 1.5 }}>
              We&rsquo;re logging into your trading account to check it works — this can take up to 30 seconds. Don&rsquo;t close this page.
            </p>
          )}
          {(!ackLink || !ackFunded) && !demoServer && (
            <p style={{ margin: '-6px 0 0', fontSize: 11.5, color: 'var(--dim)', textAlign: 'center' }}>Tick both boxes above to continue — we check them against the broker.</p>
          )}
          <button onClick={() => setStep(0)} style={linkBtn}>{t('ob.noBroker')}</button>
          <p className="mono" style={{ fontSize: 10, color: 'var(--dim)', margin: 0, letterSpacing: 0.5 }}>AES-256 · STORED SERVER-SIDE ONLY · REVOKE ANYTIME BY CHANGING YOUR PASSWORD</p>
          </>)}
        </section>
      )}

      {cur === 2 && (
        <section className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>{t('ob.step3')}</h2>
          <p style={pMuted}>{t('ob.step3.sub')}</p>
          {/* budget = dépôt déclaré à l'étape 2 : les stratégies au-dessus sont grisées avec le minimum affiché */}
          <StrategyPicker value={stratChoice} onPick={setStrategy} busy={busy} budget={budgetUsd} />
          {stratChoice === 0 && (
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: 'var(--gold)' }}>
              Your declared deposit (${budgetUsd}) is below the ${MIN_ENTRY_DEPOSIT} minimum to start copying.
              Fund your account, then go back and update the amount — or message us and we&rsquo;ll sort it out.
            </p>
          )}
          <button disabled={busy || stratChoice === 0} onClick={() => run({ action: 'strategy', choice: stratChoice }, 'done')} style={ctaMain}>{busy ? t('ob.saving') : t('ob.startCta')}</button>
          <button onClick={() => setStep(1)} style={linkBtn}>{t('ob.backMt5')}</button>
        </section>
      )}

      {err && <p style={{ fontSize: 12.5, color: 'rgba(210,150,165,.9)', margin: 0 }}>⚠ {err}</p>}

      {/* popup ALGORIA100 — cadrage honnête OBLIGATOIRE : « trading power » / crédit broker,
          jamais « double ton argent » (le bonus n'est pas du cash retirable) */}
      {bonusPop && FEATURED.bonus && (
        <div onClick={() => setBonusPop(false)} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(4,8,16,.74)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
          <section className="panel cardIn" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380, width: '100%', padding: 20, display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid rgba(245,194,74,.5)', boxShadow: '0 0 40px rgba(245,194,74,.18)' }}>
            <span style={{ fontSize: 30, textAlign: 'center' }}>🎁</span>
            <h2 style={{ margin: 0, fontSize: 16, textAlign: 'center' }}>Exclusive code unlocked</h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, textAlign: 'center' }}>
              <b className="goldText">{FEATURED.bonus.pct}% deposit bonus</b> at {FEATURED.name} with the code below — deposit $300, the AI trades with <b style={{ color: 'var(--text)' }}>$600 of buying power</b>. Enter it when you fund your account.
            </p>
            <div className="mono" style={{ textAlign: 'center', fontSize: 20, fontWeight: 800, letterSpacing: 3, color: 'var(--gold)', border: '1px dashed rgba(245,194,74,.55)', borderRadius: 10, padding: '10px 12px' }}>{FEATURED.bonus.code}</div>
            <a href={FEATURED.url} target="_blank" rel="noreferrer" onClick={() => { setBrokerPick(FEATURED.key); setBonusPop(false); }} style={ctaGold}>▲ CREATE MY {FEATURED.name.toUpperCase()} ACCOUNT</a>
            <button onClick={() => setBonusPop(false)} style={linkBtn}>Maybe later</button>
            <p className="mono" style={{ margin: 0, fontSize: 9.5, color: 'var(--dim)', textAlign: 'center', letterSpacing: 0.4, lineHeight: 1.5 }}>BONUS = TRADING CREDIT ON YOUR BROKER ACCOUNT · YOUR OWN DEPOSIT STAYS YOURS, WITHDRAWABLE ANYTIME</p>
          </section>
        </div>
      )}

      {/* porte de sortie humaine — l'onboarding est LÀ où les gens bloquent (broker, dépôt, serveur…) */}
      <a href="https://t.me/mathieu_algoria" target="_blank" rel="noreferrer"
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 15px', borderRadius: 11, textDecoration: 'none', color: 'var(--text)', border: '1px solid rgba(43,227,245,.3)', background: 'rgba(43,227,245,.05)' }}>
        <span style={{ fontSize: 17 }}>💬</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800 }}>Stuck on a step? Message Mathieu directly</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>@mathieu_algoria — real human, fast answers</span>
        </span>
      </a>
    </main>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <main style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>{children}</main>;
}
const pMuted = { color: 'var(--muted)', fontSize: 13.5, lineHeight: 1.6, margin: 0 } as const;
const lbl = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, letterSpacing: 1, color: 'var(--dim)', textTransform: 'uppercase' } as const;
const inp = { padding: '11px 13px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: 'var(--text)', fontSize: 15, outline: 'none' } as const;
const ctaMain = { padding: '13px 16px', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 800, letterSpacing: 0.6, fontSize: 13.5, color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)' } as const;
const ctaGold = { padding: '13px 16px', borderRadius: 12, textAlign: 'center', textDecoration: 'none', fontWeight: 800, letterSpacing: 0.6, fontSize: 13.5, color: '#0b0e14', background: 'linear-gradient(90deg,#ffd166,#f5a623)', boxShadow: '0 0 20px rgba(245,194,74,.25)' } as const;
const linkBtn = { padding: 6, border: 'none', background: 'transparent', color: 'var(--dim)', fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline' } as const;
// blocs visuels du wizard de connexion (regroupent les champs → moins « mur de formulaire »)
const grp = { display: 'flex', flexDirection: 'column', gap: 11, padding: '13px 13px 15px', borderRadius: 13, border: '1px solid var(--border)', background: 'rgba(10,17,31,.35)' } as const;
const grpLbl = { fontSize: 9.5, letterSpacing: 1.8, color: 'var(--dim)', fontWeight: 800 } as const;
const hint = { fontSize: 10.5, color: 'var(--dim)', marginTop: 4, lineHeight: 1.4 } as const;
