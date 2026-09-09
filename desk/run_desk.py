"""ALGORIA DESK — une analyse par marché et par jour, écrite dans Supabase (09/09/2026, décision Mathieu).

Ce que c'est : le framework TradingAgents (quatre analystes, débat haussier/baissier, chef de recherche, trader,
trois profils de risque, gérant) appliqué à l'or et au BTC. Ce que ça produit : une note sur cinq niveaux et le
raisonnement de chaque agent en texte. Ce que ce n'est PAS : une promesse de performance. Le desk est de la
matière à lire ; l'app montre aussi, à côté, si ses appels passés avaient raison.

Lancement (Railway, service planifié à 06:00 UTC) :  python run_desk.py
Un seul marché, une date passée (rejeu) :             python run_desk.py --market XAUUSD --date 2026-09-08
Vérifier la chaîne sans dépenser un appel de modèle :  python run_desk.py --dry-run

Variables d'environnement (posées sur Railway, jamais ici) :
  ANTHROPIC_API_KEY        le modèle (obligatoire hors --dry-run)
  FRED_API_KEY             macro (taux, inflation…) — gratuit, optionnel mais recommandé
  SUPABASE_URL, SUPABASE_SERVICE_KEY   destination des analyses (obligatoires)
  DESK_MARKETS             défaut "XAUUSD,BTCUSD"
  DESK_DEEP_MODEL          défaut "claude-sonnet-5"   (raisonnement : débats, décisions)
  DESK_QUICK_MODEL         défaut "claude-haiku-4-5"  (analystes, lecture des données)
  DESK_DEBATE_ROUNDS       défaut 1 (chaque tour ajoute deux appels de modèle et du coût)
  DESK_LANGUAGE            défaut "English" (la langue des rapports lisibles ; le débat interne reste en anglais)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from datetime import datetime, timezone

import requests

# ── Marchés : symbole broker → ce que TradingAgents attend. L'or est une future COMEX chez Yahoo (GC=F), le BTC
# une paire crypto ; le framework fait la traduction lui-même, on lui passe le symbole broker et le type d'actif.
MARKETS = {
    "XAUUSD": {"asset_type": "stock", "analysts": ("market", "social", "news"), "label": "Gold"},
    "BTCUSD": {"asset_type": "crypto", "analysts": ("market", "social", "news", "fundamentals"), "label": "Bitcoin"},
}
# L'or n'a pas de « fondamentaux d'entreprise » : l'analyste fondamental y lirait du vide. Sa part macro (FRED)
# est déjà portée par l'analyste news. Le BTC garde les quatre.

AGENT_FIELDS = [
    # (clé dans desk_reports, équipe, comment on l'extrait de l'état final)
    ("market", "analysts", lambda s: s.get("market_report")),
    ("sentiment", "analysts", lambda s: s.get("sentiment_report")),
    ("news", "analysts", lambda s: s.get("news_report")),
    ("fundamentals", "analysts", lambda s: s.get("fundamentals_report")),
    ("bull", "research", lambda s: (s.get("investment_debate_state") or {}).get("bull_history")),
    ("bear", "research", lambda s: (s.get("investment_debate_state") or {}).get("bear_history")),
    ("research_manager", "research", lambda s: (s.get("investment_debate_state") or {}).get("judge_decision")),
    ("trader", "trading", lambda s: s.get("trader_investment_plan")),
    ("risk_aggressive", "risk", lambda s: (s.get("risk_debate_state") or {}).get("aggressive_history")),
    ("risk_conservative", "risk", lambda s: (s.get("risk_debate_state") or {}).get("conservative_history")),
    ("risk_neutral", "risk", lambda s: (s.get("risk_debate_state") or {}).get("neutral_history")),
    ("portfolio_manager", "decision", lambda s: s.get("final_trade_decision")),
]


def env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name)
    return v if v not in (None, "") else default


# ── Supabase (PostgREST, clé service) ────────────────────────────────────────────────────────────────────────
class Store:
    def __init__(self) -> None:
        self.url = (env("SUPABASE_URL") or "").rstrip("/")
        self.key = env("SUPABASE_SERVICE_KEY") or ""
        if not self.url or not self.key:
            raise SystemExit("SUPABASE_URL / SUPABASE_SERVICE_KEY manquants")
        self.h = {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Content-Type": "application/json"}

    def latest_price(self, market: str) -> float | None:
        """Dernière clôture M1 écrite par le runner — le prix que l'app affiche, pas un autre."""
        try:
            r = requests.get(
                f"{self.url}/rest/v1/candles",
                params={"select": "close", "symbol": f"eq.{market}", "timeframe": "eq.M1", "order": "time.desc", "limit": "1"},
                headers=self.h, timeout=15,
            )
            rows = r.json() if r.ok else []
            return float(rows[0]["close"]) if rows else None
        except Exception:
            return None

    def upsert_run(self, row: dict) -> str:
        r = requests.post(
            f"{self.url}/rest/v1/desk_runs",
            params={"on_conflict": "market,run_date"},
            headers={**self.h, "Prefer": "resolution=merge-duplicates,return=representation"},
            data=json.dumps(row), timeout=30,
        )
        if not r.ok:
            raise RuntimeError(f"desk_runs upsert HTTP {r.status_code}: {r.text[:300]}")
        return str(r.json()[0]["id"])

    def replace_reports(self, run_id: str, reports: list[dict]) -> None:
        requests.delete(f"{self.url}/rest/v1/desk_reports", params={"run_id": f"eq.{run_id}"}, headers=self.h, timeout=30)
        if reports:
            r = requests.post(f"{self.url}/rest/v1/desk_reports", headers=self.h, data=json.dumps(reports), timeout=30)
            if not r.ok:
                raise RuntimeError(f"desk_reports insert HTTP {r.status_code}: {r.text[:300]}")


# ── Une analyse ───────────────────────────────────────────────────────────────────────────────────────────────
def run_market(store: Store, market: str, trade_date: str, dry_run: bool) -> None:
    spec = MARKETS[market]
    started = time.time()
    price = store.latest_price(market)
    print(f"[desk] {market} · {trade_date} · prix {price} · analystes {','.join(spec['analysts'])}", flush=True)

    if dry_run:
        final_state = {
            "market_report": f"DRY RUN — {spec['label']} technical read placeholder.",
            "news_report": "DRY RUN — macro placeholder.",
            "final_trade_decision": "**Rating**: Hold\n\nDRY RUN — no model was called.",
        }
        rating = "Hold"
    else:
        from tradingagents.default_config import DEFAULT_CONFIG
        from tradingagents.graph.trading_graph import TradingAgentsGraph

        config = DEFAULT_CONFIG.copy()
        config["llm_provider"] = "anthropic"
        config["deep_think_llm"] = env("DESK_DEEP_MODEL", "claude-sonnet-5")
        config["quick_think_llm"] = env("DESK_QUICK_MODEL", "claude-haiku-4-5")
        config["max_debate_rounds"] = int(env("DESK_DEBATE_ROUNDS", "1") or 1)
        config["max_risk_discuss_rounds"] = 1
        config["output_language"] = env("DESK_LANGUAGE", "English")
        # Sans clé FRED, la macro se tait proprement (le framework le signale dans le rapport) ; on ne casse pas.
        graph = TradingAgentsGraph(selected_analysts=spec["analysts"], debug=False, config=config)
        final_state, rating = graph.propagate(market, trade_date, asset_type=spec["asset_type"])

    reports = []
    for key, team, pick in AGENT_FIELDS:
        text = pick(final_state)
        if text and str(text).strip():
            reports.append({"agent": key, "team": team, "content_md": str(text)})
    decision = str(final_state.get("final_trade_decision") or "")
    # le résumé = le paragraphe « Executive Summary » du gérant (la ligne « Rating » seule ne dit rien)
    import re
    m = re.search(r"\*\*Executive Summary\*\*:?\s*(.*?)(?:\n\s*\n|$)", decision, re.S | re.I)
    summary = (m.group(1).strip() if m else decision.strip().split("\n\n")[0])[:600] if decision else ""
    row = {
        "market": market,
        "run_date": trade_date,
        "rating": rating,
        "price": price,
        "summary": summary,
        "decision_md": decision,
        "lang": "en",
        "model_deep": env("DESK_DEEP_MODEL", "claude-sonnet-5"),
        "model_quick": env("DESK_QUICK_MODEL", "claude-haiku-4-5"),
        "duration_s": round(time.time() - started),
        "dry_run": dry_run,
        "published": True,
        "agents": [r["agent"] for r in reports],
    }
    run_id = store.upsert_run(row)
    store.replace_reports(run_id, [{"run_id": run_id, **r} for r in reports])
    print(f"[desk] {market} · {rating} · {len(reports)} rapports · {row['duration_s']} s · run {run_id}", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--market", help="XAUUSD ou BTCUSD (défaut : DESK_MARKETS)")
    ap.add_argument("--date", help="AAAA-MM-JJ (défaut : aujourd'hui UTC)")
    ap.add_argument("--dry-run", action="store_true", help="n'appelle aucun modèle, écrit un faux run pour tester la chaîne")
    a = ap.parse_args()
    markets = [a.market] if a.market else [m.strip() for m in (env("DESK_MARKETS", "XAUUSD,BTCUSD") or "").split(",") if m.strip()]
    trade_date = a.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    # DESK_DRY_RUN=1 (variable Railway) vaut --dry-run : un redéploiement relit les variables mais garde l'ancienne
    # commande de démarrage, donc le mode se pilote par variable, sans nouveau build.
    if env("DESK_DRY_RUN") == "1":
        a.dry_run = True
    if not a.dry_run and not env("ANTHROPIC_API_KEY"):
        print("[desk] ANTHROPIC_API_KEY manquante", file=sys.stderr)
        return 2
    store = Store()
    failures = 0
    for m in markets:
        if m not in MARKETS:
            print(f"[desk] marché inconnu : {m}", file=sys.stderr)
            failures += 1
            continue
        try:
            run_market(store, m, trade_date, a.dry_run)
        except Exception:
            failures += 1
            print(f"[desk] {m} ÉCHEC\n{traceback.format_exc()}", file=sys.stderr, flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
