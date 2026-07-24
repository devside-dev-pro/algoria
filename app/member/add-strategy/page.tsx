'use client';
// ➕ AJOUTER UNE STRATÉGIE — la CONTINUITÉ d'un VIP satisfait : il tourne déjà sur une stratégie, il en
// ajoute une 2e/3e sur un NOUVEAU compte chez un NOUVEAU broker. L'argument est vrai (décorrélation :
// quand une stratégie a un jour rouge, les autres compensent souvent) et le business y gagne une
// commission broker par compte. Brokers déjà utilisés exclus, minimum par stratégie ($200/$500/$1000).
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMe, StrategyPicker, STRATEGY_UI } from '../ui';
import { BROKERS } from '@/lib/member/brokers';
import { STRATEGY_MIN_DEPOSIT } from '@/lib/member/minimums';

const STRAT_NAME: Record<number, string> = { 1: 'S1 STEADY', 2: 'S2 BALANCED', 3: 'S3 TURBO' };

export default function AddStrategy() {
  const { member, accounts, unlocked, loading } = useMe();
  const router = useRouter();
  const [strategy, setStrategy] = useState<number | null>(null);
  const [brokerPick, setBrokerPick] = useState<string | null>(null);
  const [platform, setPlatform] = useState<'mt5' | 'mt4'>('mt5');
  const [login, setLogin] = useState('');
  const [server, setServer] = useState('');
  const [serverManual, setServerManual] = useState(false);
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [deposit, setDeposit] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const activeExtras = useMemo(() => accounts.filter((a) => a.status !== 'rejected'), [accounts]);
  const usedStrategies = useMemo(() => new Set<number>([Number(member?.strategy ?? 2), ...activeExtras.map((a) => a.strategy)]), [member, activeExtras]);
  const usedBrokers = useMemo(() => new Set<string>([String(member?.broker ?? ''), ...activeExtras.map((a) => String(a.broker ?? ''))].filter(Boolean)), [member, activeExtras]);
  const remaining = STRATEGY_UI.filter((s) => !usedStrategies.has(s.id));
  const freeBrokers = BROKERS.filter((b) => !usedBrokers.has(b.key));
  const brokerServers = BROKERS.find((b) => b.key === brokerPick)?.servers ?? [];
  const minDep = strategy != null ? STRATEGY_MIN_DEPOSIT[strategy] ?? 500 : null;

  if (loading || !member) return <Center>loading…</Center>;
  // réservé aux membres déjà LIVE (continuité VIP) — un prospect passe d'abord par l'onboarding classique
  if (!unlocked || !['live', 'paused'].includes(member.status)) { router.replace('/member'); return <Center>redirecting…</Center>; }

  const submit = () => {
    setBusy(true);
    setErr(null);
    void fetch('/api/member/me', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_account', strategy, broker: brokerPick, platform, login, server, password, name: fullName, deposit }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? 'request failed');
        setDone(true);
      })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setBusy(false));
  };

  if (done)
    return (
      <main style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 8 }}>
        <section className="panel cardIn" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'center', borderColor: 'rgba(31,216,176,.4)' }}>
          <span style={{ fontSize: 34 }}>🎉</span>
          <h1 style={{ fontSize: 18, margin: 0 }}>Request received!</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
            The team is verifying your new account and connecting it to <b style={{ color: 'var(--text)' }}>{STRAT_NAME[strategy ?? 0]}</b>.
            You&rsquo;ll get a notification the moment it goes live — usually within a few hours.
          </p>
          <button onClick={() => router.push('/member')} style={ctaMain}>← BACK TO HOME</button>
        </section>
      </main>
    );

  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 8 }}>
      <header>
        <h1 style={{ fontSize: 19, margin: 0 }}>➕ Add a strategy</h1>
        <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 }}>
          Run several Algoria strategies side by side — each on its own account. When one has a red day, the others often cover it: that&rsquo;s real diversification.
        </p>
      </header>

      {/* SES comptes actuels — le point de départ visuel ("tu as déjà ça, ajoute le reste") */}
      <section className="panel" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: 1.6, color: 'var(--dim)', fontWeight: 800 }}>YOUR STRATEGIES</span>
        <Row icon="✓" name={STRAT_NAME[Number(member.strategy ?? 2)]} sub={`${brokerName(member.broker)} · main account`} color="var(--up)" />
        {accounts.map((a) => (
          <Row key={a.account_no} icon={a.status === 'live' ? '✓' : a.status === 'pending' ? '⧗' : a.status === 'rejected' ? '✗' : '⏸'}
            name={STRAT_NAME[a.strategy]} sub={`${brokerName(a.broker)} · ${a.status === 'pending' ? 'under review' : a.status}`}
            color={a.status === 'live' ? 'var(--up)' : a.status === 'rejected' ? 'rgba(210,150,165,.85)' : 'var(--gold)'} />
        ))}
      </section>

      {remaining.length === 0 ? (
        <section className="panel" style={{ padding: 16, textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--gold)', fontWeight: 700 }}>🏆 You run the full fleet — all 3 strategies. Maximum diversification.</p>
        </section>
      ) : (
        <>
          {/* 1 · stratégie à ajouter (celles qu'il n'a pas), minimum affiché par carte */}
          <section className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={{ fontSize: 14.5, margin: 0 }}>1 · Pick the strategy to add</h2>
            <StrategyPicker value={strategy ?? 0} onPick={setStrategy} busy={busy} exclude={[...usedStrategies]} />
            {minDep != null && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
                Minimum deposit for this strategy: <b className="goldText">${minDep}</b> — fund the new account with at least that.
              </p>
            )}
          </section>

          {/* 2 · broker (les siens exclus — un nouveau compte = un nouveau broker) */}
          {strategy != null && (
            <section className="panel cardIn" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h2 style={{ fontSize: 14.5, margin: 0 }}>2 · Open an account with a new broker</h2>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55 }}>
                Each strategy runs on its own broker — pick one you don&rsquo;t have yet, open the account, fund it with <b className="goldText">${minDep}+</b>.
              </p>
              {freeBrokers.map((b) => (
                <a key={b.key} href={b.url} target="_blank" rel="noreferrer" onClick={() => { setBrokerPick(b.key); setServer(''); setServerManual(false); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 11, textDecoration: 'none', color: 'var(--text)', border: `1px solid ${brokerPick === b.key ? 'rgba(43,227,245,.5)' : 'var(--border)'}`, background: brokerPick === b.key ? 'rgba(43,227,245,.07)' : 'rgba(10,17,31,.55)' }}>
                  <span style={{ fontWeight: 750, fontSize: 13.5 }}>{b.name}</span>
                  {b.featured && <span className="mono" style={{ fontSize: 8.5, letterSpacing: 1, color: 'var(--gold)', border: '1px solid rgba(245,194,74,.4)', borderRadius: 4, padding: '1px 5px' }}>ALGORIA&rsquo;S BROKER</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: brokerPick === b.key ? 'var(--cyan)' : 'var(--dim)' }}>{brokerPick === b.key ? '✓ selected' : 'open account ↗'}</span>
                </a>
              ))}
            </section>
          )}

          {/* 3 · connexion MT du nouveau compte (même formulaire que l'onboarding) */}
          {strategy != null && brokerPick && (
            <section className="panel cardIn" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <h2 style={{ fontSize: 14.5, margin: 0 }}>3 · Connect the new account</h2>
              <label style={{ ...lbl }}>Platform
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['mt5', 'mt4'] as const).map((p) => (
                    <button key={p} type="button" onClick={() => setPlatform(p)}
                      style={{ flex: 1, padding: '10px 6px', borderRadius: 10, cursor: 'pointer', fontWeight: 800, fontSize: 12.5,
                        border: `1px solid ${platform === p ? 'rgba(43,227,245,.55)' : 'var(--border)'}`, background: platform === p ? 'rgba(43,227,245,.08)' : 'rgba(10,17,31,.55)', color: platform === p ? 'var(--cyan)' : 'var(--muted)' }}>
                      {p.toUpperCase()}
                    </button>
                  ))}
                </div>
              </label>
              <label style={lbl}>{platform.toUpperCase()} login<input value={login} onChange={(e) => setLogin(e.target.value)} inputMode="numeric" placeholder="12345678" style={inp} /></label>
              <label style={lbl}>Server
                {brokerServers.length > 0 && !serverManual ? (
                  <select value={server} onChange={(e) => { const v = e.target.value; if (v === '__other__') { setServerManual(true); setServer(''); } else setServer(v); }} style={inp}>
                    <option value="">— choose your server —</option>
                    {brokerServers.map((sv) => <option key={sv} value={sv}>{sv}</option>)}
                    <option value="__other__">My server isn&apos;t listed…</option>
                  </select>
                ) : (
                  <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="type it EXACTLY as MetaTrader shows it" style={inp} />
                )}
              </label>
              <label style={lbl}>Password<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="••••••••" style={inp} />
                <span style={hint}>Your <b style={{ color: 'var(--muted)' }}>main</b> password — not the read-only &ldquo;investor&rdquo; one.</span></label>
              <label style={lbl}>Full name on the account<input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="John Smith" autoComplete="name" style={inp} /></label>
              <label style={lbl}>Amount deposited ($ — min {minDep})<input value={deposit} onChange={(e) => setDeposit(e.target.value)} inputMode="numeric" placeholder={String(minDep)} style={inp} /></label>
              <button disabled={busy || !login || !server || !password || fullName.trim().length < 3 || !(Number(deposit) >= (minDep ?? 0))} onClick={submit} style={ctaMain}>
                {busy ? 'ENCRYPTING…' : `⚡ ADD ${STRAT_NAME[strategy]} →`}
              </button>
              <p className="mono" style={{ fontSize: 10, color: 'var(--dim)', margin: 0, letterSpacing: 0.5 }}>AES-256 · STORED SERVER-SIDE ONLY</p>
            </section>
          )}
        </>
      )}

      {err && <p style={{ fontSize: 12.5, color: 'rgba(210,150,165,.9)', margin: 0 }}>⚠ {err}</p>}

      <a href="https://t.me/mathieu_algoria" target="_blank" rel="noreferrer"
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 15px', borderRadius: 11, textDecoration: 'none', color: 'var(--text)', border: '1px solid rgba(43,227,245,.3)', background: 'rgba(43,227,245,.05)' }}>
        <span style={{ fontSize: 17 }}>💬</span>
        <span style={{ fontSize: 12.5, fontWeight: 800 }}>Questions? Message Mathieu — @mathieu_algoria</span>
      </a>
    </main>
  );
}

function brokerName(key: string | null): string {
  return BROKERS.find((b) => b.key === key)?.name ?? (key || 'broker');
}
function Row({ icon, name, sub, color }: { icon: string; name: string; sub: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ color, fontSize: 13, minWidth: 16 }}>{icon}</span>
      <span style={{ fontSize: 12.5, fontWeight: 750 }}>{name}</span>
      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--dim)' }}>{sub}</span>
    </div>
  );
}
function Center({ children }: { children: React.ReactNode }) {
  return <main style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dim)' }}>{children}</main>;
}
const lbl = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, letterSpacing: 1, color: 'var(--dim)', textTransform: 'uppercase' } as const;
const inp = { padding: '11px 13px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(10,17,31,.7)', color: 'var(--text)', fontSize: 15, outline: 'none' } as const;
const ctaMain = { padding: '13px 16px', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 800, letterSpacing: 0.6, fontSize: 13.5, color: '#0b0e14', background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)' } as const;
const hint = { fontSize: 10.5, color: 'var(--dim)', marginTop: 4, lineHeight: 1.4 } as const;
