'use client';
// ALGORIA ADMIN — le back-office CRM de l'opérateur (admin.algoria.tech). Desktop-first, hors coque membre.
// 6 espaces : DASHBOARD (les chiffres qui comptent), QUEUE (à appliquer dans Social Trade Hub),
// MEMBERS (le CRM : recherche, statuts, comptes), DEPOSITS (le registre des dépôts broker → bilan
// mensuel exportable en CSV), AFFILIATE (l'argent des parrains), TOOLS (whitelist, push).
// Garde : l'API /api/member/admin renvoie 403 à quiconque n'est pas dans ADMIN_TG_USERNAMES — cette page
// n'est qu'une façade. Session : le même login Telegram que l'espace membre.
import { DialogHost } from '@/components/admin/Dialog';
import { useAdminState, AdminCtx } from './_state';
import { warnBox } from './_shared';
import { DashboardTab } from './tabs/DashboardTab';
import { QueueTab } from './tabs/QueueTab';
import { MembersTab } from './tabs/MembersTab';
import { DepositsTab } from './tabs/DepositsTab';
import { AffiliateTab } from './tabs/AffiliateTab';
import { ToolsTab } from './tabs/ToolsTab';

export default function AdminCRM() {
  const s = useAdminState();
  if (s.gate) return s.gate;
  const { TABS, actions, busy, deposits, leads, liveAlert, market, post, rows, runnerLastSeen, setMarket, setTab, tab } = s;
  return (
    <AdminCtx.Provider value={s}>
      <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <DialogHost />
        {/* ===== barre haute : marque + navigation + actions globales ===== */}
        <header style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '12px 22px', borderBottom: '1px solid var(--border)', background: 'rgba(8,16,31,.6)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/brand/algoria-mark.png" alt="" width={24} height={24} style={{ objectFit: 'contain', filter: 'drop-shadow(0 0 8px rgba(43,227,245,.4))' }} />
            <strong style={{ fontSize: 15, letterSpacing: 0.5, background: 'linear-gradient(90deg,#2be3f5,#2e8bf0)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>ALGORIA</strong>
            <span className="mono goldText" style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2 }}>ADMIN</span>
          </div>
          <nav style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 9, cursor: 'pointer',
                fontSize: 11, fontWeight: 800, letterSpacing: 1,
                border: `1px solid ${tab === t.key ? 'rgba(43,227,245,.5)' : 'transparent'}`,
                background: tab === t.key ? 'rgba(43,227,245,.08)' : 'transparent',
                color: tab === t.key ? 'var(--cyan)' : 'var(--muted)',
              }}>
                {t.label}
                {!!t.badge && <span className="mono" style={{ fontSize: 9.5, fontWeight: 800, padding: '1px 6px', borderRadius: 8, background: tab === t.key ? 'rgba(43,227,245,.15)' : 'rgba(245,194,74,.14)', color: tab === t.key ? 'var(--cyan)' : 'var(--gold)' }}>{t.badge}</span>}
              </button>
            ))}
          </nav>
          <span style={{ flex: 1 }} />
          {/* 🌍 MARCHÉ — bascule UK / Italie : filtre les membres ET le registre des dépôts (deux entités
              comptables séparées). Visible en permanence : savoir « sur quel marché je regarde » est aussi
              important que l'onglet où l'on se trouve. */}
          <div style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 9, border: '1px solid var(--border)', background: 'rgba(10,17,31,.6)' }}>
            {([['all', '🌍 ALL'], ['en', '🇬🇧 UK'], ['it', '🇮🇹 IT']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setMarket(k)} className="mono" title={k === 'all' ? 'both markets' : k === 'en' ? 'English channel (UK/UAE/DE…)' : 'Italian channel'}
                style={{ padding: '5px 9px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
                  background: market === k ? 'rgba(43,227,245,.14)' : 'transparent', color: market === k ? 'var(--cyan)' : 'var(--dim)' }}>
                {label}{market === k && k !== 'all' ? ` · ${rows.filter((r) => String(r.locale ?? 'en') === k).length}` : ''}
              </button>
            ))}
          </div>
          <button disabled={busy} onClick={liveAlert} style={{ padding: '7px 13px', borderRadius: 9, border: '1px solid rgba(255,90,60,.5)', background: 'rgba(255,90,60,.08)', color: '#ff8a5c', fontWeight: 800, letterSpacing: 0.6, fontSize: 11, cursor: 'pointer' }}>📣 LIVE ALERT</button>
          <form action="/api/member/logout" method="post" style={{ display: 'flex' }}>
            <button style={{ padding: '7px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--dim)', fontSize: 11, cursor: 'pointer' }}>sign out</button>
          </form>
        </header>

        <div style={{ flex: 1, width: '100%', maxWidth: 1240, margin: '0 auto', padding: '18px 22px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* WATCHDOG — visible sur TOUS les onglets : si le runner n'écrit plus de bougie depuis > 20 min
              (BTC 24/7 → il devrait toujours en écrire), quelque chose est mort côté Railway. */}
          {runnerLastSeen != null && Date.now() - runnerLastSeen > 20 * 60_000 && (
            <div style={{ ...warnBox, borderColor: 'rgba(255,90,60,.6)', background: 'rgba(255,90,60,.1)', color: '#ff8a5c', fontWeight: 800 }}>
              🚨 RUNNER SILENT — no candle written for {Math.floor((Date.now() - runnerLastSeen) / 60_000)} min. Check Railway (the cron also pushes this alert to your phone).
            </div>
          )}
          {/* ===== DASHBOARD — les chiffres qui comptent, toujours en tête ===== */}
          {tab === 'dashboard' && <DashboardTab />}

          {/* ===== QUEUE — à appliquer dans Social Trade Hub ===== */}
          {tab === 'queue' && <QueueTab />}

          {/* ===== MEMBERS — le CRM : recherche + table complète + FICHE au clic ===== */}
          {tab === 'members' && <MembersTab />}
          {/* PUSH ALERTS : réduit à UNE ligne de stat — le mur de 85 chips « à relancer » prenait tout
              l'écran sans être actionnable (retiré à la demande de Mathieu, 27/07). Le compteur reste :
              c'est le seul signal utile (couverture push de la base). */}


          {/* ===== DEPOSITS — le registre des dépôts broker : la source du bilan de fin de mois ===== */}
          {tab === 'deposits' && <DepositsTab />}

          {/* ===== AFFILIATE — l'argent des parrains ===== */}
          {tab === 'affiliate' && <AffiliateTab />}

          {/* ===== TOOLS — la boîte à outils de l'opérateur : push composer, relance des leads, legacy ===== */}
          {tab === 'tools' && <ToolsTab />}
        </div>
      </main>
    </AdminCtx.Provider>
  );
}
