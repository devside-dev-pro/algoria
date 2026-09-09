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
  DESK_BRIEF_MODEL         défaut = DESK_DEEP_MODEL (le brief « tout le monde », une passe de modèle en plus)
  DESK_FORCE               "1" pour refaire un marché déjà analysé ce jour (sinon on ne repaie pas le graphe)
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

    def close_at(self, market: str, ts_ms: int) -> float | None:
        """La dernière clôture au plus tard à cet instant — nos bougies, jamais une source extérieure.

        M5 puis M1 : ce sont les seules unités que le runner écrit en continu (M15 et H1 sont d'anciens imports,
        ils s'arrêtent en cours de route — vérifié le 10/09). H1 reste en dernier recours pour les vieux runs.
        Un marché fermé (week-end, jour férié) renvoie la dernière clôture connue : c'est le prix qu'un membre
        aurait vu, donc c'est celui qu'on affiche. Au-delà de quatre jours d'écart, on n'écrit rien plutôt qu'un
        chiffre trompeur.
        """
        for tf in ("M5", "M1", "H1"):
            try:
                r = requests.get(
                    f"{self.url}/rest/v1/candles",
                    params={"select": "close,time", "symbol": f"eq.{market}", "timeframe": f"eq.{tf}",
                            "time": f"lte.{ts_ms}", "order": "time.desc", "limit": "1"},
                    headers=self.h, timeout=15,
                )
                rows = r.json() if r.ok else []
                if rows and ts_ms - int(rows[0]["time"]) <= 4 * 86_400_000:
                    return float(rows[0]["close"])
            except Exception:
                continue
        return None

    def runs_missing_prices(self, limit: int = 60) -> list[dict]:
        r = requests.get(
            f"{self.url}/rest/v1/desk_runs",
            params={"select": "id,market,created_at,price,price_1d,price_3d,price_7d", "dry_run": "eq.false",
                    "order": "run_date.desc", "limit": str(limit)},
            headers=self.h, timeout=20,
        )
        return r.json() if r.ok else []

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

    def find_run(self, market: str, run_date: str) -> dict | None:
        r = requests.get(
            f"{self.url}/rest/v1/desk_runs",
            params={"select": "id,dry_run,rating,decision_md,brief", "market": f"eq.{market}", "run_date": f"eq.{run_date}", "limit": "1"},
            headers=self.h, timeout=15,
        )
        rows = r.json() if r.ok else []
        return rows[0] if rows else None

    def fetch_reports(self, run_id: str) -> list[dict]:
        r = requests.get(
            f"{self.url}/rest/v1/desk_reports",
            params={"select": "agent,team,content_md", "run_id": f"eq.{run_id}"}, headers=self.h, timeout=15,
        )
        return r.json() if r.ok else []

    def patch_run(self, run_id: str, fields: dict) -> None:
        r = requests.patch(f"{self.url}/rest/v1/desk_runs", params={"id": f"eq.{run_id}"}, headers=self.h, data=json.dumps(fields), timeout=30)
        if not r.ok:
            raise RuntimeError(f"desk_runs patch HTTP {r.status_code}: {r.text[:300]}")


# ── Le brief : la version « monsieur et madame tout le monde » (10/09/2026, retour Mathieu : « une encyclopédie,
# personne ne va lire ça »). Une passe de modèle en plus, hors du graphe, qui lit tout le travail du desk et le
# rend en langage courant : un titre, trois phrases, ce que la note veut dire, deux prix, ce qui ferait changer
# d'avis, et une ligne par agent (pour ouvrir le détail seulement si on veut). Pas de jargon, pas de promesse.
BRIEF_SYSTEM = """You write for Algoria Desk, a mobile app read by ordinary people who follow gold and bitcoin but are not traders.
You receive today's full internal work of an AI analyst desk (analysts, bull/bear debate, trader, risk team, manager's verdict).
Turn it into a short brief in plain English. Rules: everyday words, no jargon (no RSI, MACD, SMA, Bollinger, Elliott, COT,
wave, confluence, divergence...); when a level matters, give the price, not the indicator that produced it. Short sentences.
Concrete and honest, never salesy, never a promise. Never say "buy now" or "sell now": describe what the desk thinks and
what would change its mind. Answer with ONE JSON object and nothing else:
{
 "headline": "one sentence, max 90 characters, what today is about",
 "story": ["exactly three sentences, max 160 characters each: what is going on and why it matters, for a non-trader"],
 "call": "max 220 characters: what the desk's rating means in practice, in everyday words",
 "levels": {"floor": number or null, "ceiling": number or null},
 "flip": {"up": "one sentence: what would make the desk turn positive", "down": "one sentence: what would make it turn negative"},
 "voices": {"<agent key>": "one line, max 110 characters, that agent's takeaway"}
}"""


def make_brief(market: str, rating: str, decision: str, reports: list[dict]) -> dict | None:
    """≈ 5 centimes par marché. Un échec ici ne casse jamais le run : pas de brief, l'app retombe sur le résumé."""
    try:
        import anthropic
    except ImportError:
        print("[desk] paquet anthropic absent : pas de brief", file=sys.stderr)
        return None
    model = env("DESK_BRIEF_MODEL") or env("DESK_DEEP_MODEL", "claude-sonnet-5") or "claude-sonnet-5"
    label = MARKETS[market]["label"]
    parts = [f"# Market: {label} ({market})\n# Manager's rating: {rating}\n\n## Manager's verdict\n{decision[:6000]}"]
    for r in reports:
        parts.append(f"\n## Agent `{r['agent']}` ({r.get('team', '')})\n{str(r.get('content_md') or '')[:5000]}")
    keys = ", ".join(r["agent"] for r in reports) or "none"
    try:
        client = anthropic.Anthropic()
        # pas de temperature : les modèles Claude 5 la refusent, et le SDK 1.x n'a plus l'argument
        msg = client.messages.create(
            model=model, max_tokens=1500,
            system=BRIEF_SYSTEM + "\nAgent keys present today (use only these): " + keys,
            messages=[{"role": "user", "content": "\n".join(parts)}],
        )
        text = "".join(getattr(b, "text", "") for b in msg.content)
        start, end = text.find("{"), text.rfind("}")
        brief = json.loads(text[start:end + 1])
        if not isinstance(brief, dict) or not str(brief.get("headline") or "").strip():
            raise ValueError("brief sans headline")
        brief["model"] = model
        return brief
    except Exception as e:  # noqa: BLE001 — on log, on continue
        print(f"[desk] brief {market} : {type(e).__name__}: {str(e)[:200]}", file=sys.stderr, flush=True)
        return None


# ── Le suivi des appels (10/09/2026) ─────────────────────────────────────────────────────────────────────────
# Chaque matin, avant d'analyser, on va chercher ce que le prix a fait 1, 3 et 7 jours après chaque appel passé.
# C'est la moitié honnête du desk : l'app affiche ces chiffres tels quels, bons ou mauvais. Source unique : nos
# propres bougies (le même prix que le graphique de l'app), jamais celle qu'ont lue les agents.
HORIZONS = (("price_1d", 1), ("price_3d", 3), ("price_7d", 7))


def parse_ts(value: str) -> datetime | None:
    """PostgREST rend « 2026-09-09 15:15:15.754177+00 » — pas toujours digeste pour fromisoformat."""
    s = (value or "").strip().replace(" ", "T")
    if s.endswith("+00"):
        s += ":00"
    for candidate in (s, s.split(".")[0] + "+00:00" if "." in s else s):
        try:
            d = datetime.fromisoformat(candidate)
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def backfill_prices(store: Store) -> None:
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    filled = 0
    for run in store.runs_missing_prices():
        started = parse_ts(str(run.get("created_at") or ""))
        if not started:
            continue
        patch = {}
        for field, days in HORIZONS:
            if run.get(field) is not None:
                continue
            target = int(started.timestamp() * 1000) + days * 86_400_000
            if target > now_ms:
                continue  # l'échéance n'est pas encore passée : on ne devine pas
            price = store.close_at(str(run.get("market") or ""), target)
            if price is not None:
                patch[field] = price
        if patch:
            try:
                store.patch_run(str(run["id"]), patch)
                filled += 1
                print(f"[desk] suivi {run.get('market')} · {' '.join(sorted(patch))}", flush=True)
            except Exception as e:  # noqa: BLE001 — le suivi ne doit jamais empêcher l'analyse du jour
                print(f"[desk] suivi {run.get('market')} : {type(e).__name__}: {str(e)[:150]}", file=sys.stderr, flush=True)
    print(f"[desk] suivi des appels : {filled} run(s) complété(s)", flush=True)


# ── Une analyse ───────────────────────────────────────────────────────────────────────────────────────────────
def run_market(store: Store, market: str, trade_date: str, dry_run: bool) -> None:
    spec = MARKETS[market]
    started = time.time()
    # Déjà analysé ce jour (un nouveau build Railway relance la commande) : on ne repaie pas le graphe. Sans
    # DESK_FORCE=1 on complète seulement ce qui manque au run existant — le brief.
    existing = store.find_run(market, trade_date)
    # Un passage à blanc n'écrase jamais une vraie analyse du jour (l'upsert le ferait sans ce garde-fou).
    if dry_run and existing and not existing.get("dry_run"):
        print(f"[desk] {market} · {trade_date} · vraie analyse déjà en base, le passage à blanc ne la touche pas", flush=True)
        return
    if not dry_run and existing and not existing.get("dry_run") and env("DESK_FORCE") != "1":
        if existing.get("brief"):
            print(f"[desk] {market} · {trade_date} · déjà analysé, brief présent : rien à faire", flush=True)
            return
        reports = store.fetch_reports(existing["id"])
        brief = make_brief(market, existing.get("rating") or "REVIEW", existing.get("decision_md") or "", reports)
        if brief:
            store.patch_run(existing["id"], {"brief": brief})
        print(f"[desk] {market} · {trade_date} · brief {'ajouté' if brief else 'ÉCHEC'} sur le run existant", flush=True)
        return

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
    if dry_run:
        brief = {"headline": "DRY RUN — nothing was analysed.", "story": [], "call": "", "levels": {}, "flip": {}, "voices": {}}
    else:
        brief = make_brief(market, rating, decision, reports)
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
        "brief": brief,
    }
    run_id = store.upsert_run(row)
    store.replace_reports(run_id, [{"run_id": run_id, **r} for r in reports])
    print(f"[desk] {market} · {rating} · {len(reports)} rapports · brief {'oui' if brief else 'NON'} · {row['duration_s']} s · run {run_id}", flush=True)


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
    # Le suivi des appels passés d'abord : court, gratuit, et il doit tourner même si une analyse échoue ensuite.
    try:
        backfill_prices(store)
    except Exception:  # noqa: BLE001
        print(f"[desk] suivi des appels ÉCHEC\n{traceback.format_exc()}", file=sys.stderr, flush=True)
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
