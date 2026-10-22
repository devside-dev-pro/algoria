//+------------------------------------------------------------------+
//|                                           Algoria_XAU_MABB.mq5   |
//|  EA court terme sur l'or : croisement de moyennes mobiles et/ou  |
//|  bandes de Bollinger, avec un quota de 4 à 5 trades par jour.    |
//+------------------------------------------------------------------+
// Réglages par défaut = la demande de Mathieu (EMA courtes, filtre ADX, RR « négatif » de 0,5, lot fixe), mesurés sur
// les 6 DERNIERS MOIS de M5 broker seulement (22/04 → 22/10/2026, backtest/mabb-6m.ts), coupés en deux moitiés de
// 3 mois : un changement ne compte que s'il fait mieux sur les deux. 1 lot, coûts 0,32 $/oz :
//   EMA 3/8 + tendance EMA 200, ADX(14) ≥ 20 avec +DI/−DI, stop 3 ATR, TP 1,5 ATR, rattrapage dès 14 h, et SORTIE
//   AU TEMPS : un trade qui n'a touché ni stop ni TP au bout de 90 min est fermé à la clôture de la bougie.
//   PF 1,14 puis 1,24 sur les deux moitiés, 1,19 sur 6 mois (+40 k$), pire creux −13 k$, 4,3 trades/jour.
//   La v1.10 (EMA 50, sans sortie au temps) faisait PF 0,92 puis 1,07, 0,99 sur 6 mois (−3,5 k$), creux −29 k$.
// La sortie au temps est le seul changement qui améliore les deux moitiés ; elle marche de 30 min à 2 h et avec une
// tendance EMA 200 ou 600 (PF 1,11 à 1,24 sur chaque moitié) : 90 min et EMA 200 sont le cœur de cette zone, choisis
// APRÈS avoir vu les 6 mois, donc optimistes par construction. Les règles Bollinger, BBRSI de geraked (sans sa
// grille) et la « Moving Average » de MetaQuotes perdent toutes (backtest/mabb-arena.ts) : les modes Bollinger
// restent là pour être testés.
// Le MAXIMUM de trades par jour est un plafond dur. Le MINIMUM ne peut pas se décréter : à partir de
// InpCatchUpHour, s'il manque des trades, la même règle sans filtre de tendance prend le relais. Les jours trop
// calmes, l'EA finit sous le minimum ; il n'ouvre jamais de trade sans signal.
#property copyright "Algoria"
#property link      "https://getalgoria.com"
#property version   "1.20"
#property description "Or (XAUUSD) court terme : EMA 3/8 + EMA 200, filtre ADX, RR 0,5, sortie après 90 min, lot fixe, 4 à 5 trades par jour."
#property description "Toujours valider en démo et au Strategy Tester (ticks réels) avant le réel."

#include <Trade\Trade.mqh>

enum ENUM_MABB_SIGNAL
  {
   MABB_EMA_CROSS = 0,     // Croisement EMA rapide / lente (+ filtre EMA tendance)
   MABB_BB_REVERSION = 1,  // Bollinger : retour à la moyenne + RSI
   MABB_BB_BREAKOUT = 2,   // Bollinger : cassure dans le sens de l'EMA tendance
   MABB_EMA_OR_BB = 3      // Croisement EMA, sinon retour à la moyenne Bollinger
  };

enum ENUM_MABB_CATCHUP
  {
   MABB_CATCHUP_OFF = 0,          // Pas de rattrapage (le minimum n'est qu'un objectif)
   MABB_CATCHUP_EMA_NO_FILTER = 1,// Croisement EMA sans filtre de tendance
   MABB_CATCHUP_BB_WIDE = 2       // Retour à la moyenne sur bandes resserrées
  };

input group "Signal"
input ENUM_MABB_SIGNAL  InpSignalMode      = MABB_EMA_CROSS;   // Règle d'entrée
input ENUM_TIMEFRAMES   InpTimeframe       = PERIOD_M5;        // Unité de temps des signaux
input int               InpFastEMA         = 3;                // EMA rapide
input int               InpSlowEMA         = 8;                // EMA lente
input int               InpTrendEMA        = 200;              // EMA de tendance (0 = sans filtre)
input int               InpBBPeriod        = 20;               // Bollinger : période
input double            InpBBDeviation     = 2.0;              // Bollinger : écarts-types
input int               InpRSIPeriod       = 14;               // RSI : période
input double            InpRSIExtreme      = 30.0;             // RSI : seuil de survente (surachat = 100 - seuil)
input int               InpADXPeriod       = 14;               // ADX : période (iADX de MT5)
input double            InpADXMin          = 20;               // ADX minimum pour un signal EMA (0 = sans seuil ; voir aussi InpADXUseDI)
input bool              InpADXUseDI        = true;             // ADX : exiger +DI > -DI à l'achat, l'inverse à la vente (false + ADX 0 = sans filtre)

input group "Quota journalier"
input int               InpMinTradesPerDay = 4;                // Minimum visé de trades par jour
input int               InpMaxTradesPerDay = 5;                // Maximum de trades par jour (plafond dur)
input ENUM_MABB_CATCHUP InpCatchUpMode     = MABB_CATCHUP_EMA_NO_FILTER; // Rattrapage si le minimum n'est pas atteint (filtre ADX conservé)
input int               InpCatchUpHour     = 14;               // Heure serveur à partir de laquelle on rattrape
input double            InpCatchUpBBDev    = 1.5;              // Rattrapage Bollinger : écarts-types
input double            InpCatchUpRSI      = 40.0;             // Rattrapage Bollinger : seuil RSI
input int               InpMinMinutesApart = 0;                // Écart minimal entre deux entrées (minutes, 0 = libre)

input group "Session (heure du serveur MT5)"
input int               InpSessionStart    = 9;                // Première heure d'entrée
input int               InpSessionEnd      = 22;               // Plus d'entrée à partir de cette heure
input int               InpFlatHour        = 23;               // Tout fermer à partir de cette heure
input int               InpFridayFlatHour  = 21;               // Vendredi : tout fermer et ne plus entrer à partir de cette heure
input int               InpCloseBeforeEnd  = 10;               // Fermer N minutes avant la fin de séance du broker (0 = off)

input group "Sorties"
input int               InpATRPeriod       = 14;               // ATR : période
input double            InpStopATR         = 3.0;              // Stop = ATR × ce multiple
input double            InpRewardRisk      = 0.5;              // RR : TP = stop × ce ratio (0,5 = TP à la moitié du stop)
input bool              InpExitOnCross     = false;            // Fermer aussi au croisement EMA inverse
input int               InpMaxHoldMinutes  = 90;               // Fermer à la clôture de bougie si ni stop ni TP au bout de N minutes (0 = off)

input group "Risque"
input double            InpFixedLots       = 0.01;             // Lot fixe par trade (0 = calcul au risque ci-dessous)
input double            InpRiskPercent     = 0.5;              // Risque par trade, % de l'équité (seulement si lot fixe = 0)
input double            InpDailyLossPct    = 2.0;              // Perte du jour max, % du solde (0 = off)
input double            InpMaxSpread       = 0.50;             // Spread max en prix, soit $ par once sur l'or (0 = off)
input int               InpSlippagePoints  = 30;               // Glissement toléré en points
input ulong             InpMagic           = 26102201;         // Numéro magique

CTrade   g_trade;
int      g_hFast = INVALID_HANDLE, g_hSlow = INVALID_HANDLE, g_hTrend = INVALID_HANDLE;
int      g_hBB = INVALID_HANDLE, g_hBBWide = INVALID_HANDLE, g_hRSI = INVALID_HANDLE, g_hATR = INVALID_HANDLE, g_hADX = INVALID_HANDLE;
datetime g_lastBar = 0;
datetime g_lastEntry = 0;
// bilan de fin de test : jours de session, jours au minimum, trades
int      g_statDay = -1, g_statDayTrades = 0, g_statDays = 0, g_statDaysMin = 0, g_statDaysCapped = 0;

//+------------------------------------------------------------------+
int OnInit()
  {
   if(InpMaxTradesPerDay < 1 || InpMinTradesPerDay < 0 || InpMinTradesPerDay > InpMaxTradesPerDay)
     {
      Print("Quota invalide : il faut 0 <= minimum <= maximum et maximum >= 1.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(InpFastEMA < 1 || InpSlowEMA <= InpFastEMA || InpStopATR <= 0 || InpRewardRisk <= 0 || InpADXPeriod < 1)
     {
      Print("Paramètres invalides : EMA lente > EMA rapide, stop, ratio et période ADX > 0.");
      return INIT_PARAMETERS_INCORRECT;
     }
   g_hFast  = iMA(_Symbol, InpTimeframe, InpFastEMA, 0, MODE_EMA, PRICE_CLOSE);
   g_hSlow  = iMA(_Symbol, InpTimeframe, InpSlowEMA, 0, MODE_EMA, PRICE_CLOSE);
   if(InpTrendEMA > 0)
      g_hTrend = iMA(_Symbol, InpTimeframe, InpTrendEMA, 0, MODE_EMA, PRICE_CLOSE);
   g_hBB     = iBands(_Symbol, InpTimeframe, InpBBPeriod, 0, InpBBDeviation, PRICE_CLOSE);
   g_hBBWide = iBands(_Symbol, InpTimeframe, InpBBPeriod, 0, InpCatchUpBBDev, PRICE_CLOSE);
   g_hRSI    = iRSI(_Symbol, InpTimeframe, InpRSIPeriod, PRICE_CLOSE);
   g_hATR    = iATR(_Symbol, InpTimeframe, InpATRPeriod);
   g_hADX    = iADX(_Symbol, InpTimeframe, InpADXPeriod);
   if(g_hFast == INVALID_HANDLE || g_hSlow == INVALID_HANDLE || (InpTrendEMA > 0 && g_hTrend == INVALID_HANDLE) ||
      g_hBB == INVALID_HANDLE || g_hBBWide == INVALID_HANDLE || g_hRSI == INVALID_HANDLE || g_hATR == INVALID_HANDLE ||
      g_hADX == INVALID_HANDLE)
     {
      Print("Indicateurs impossibles à créer, erreur ", GetLastError());
      return INIT_FAILED;
     }
   g_trade.SetExpertMagicNumber(InpMagic);
   g_trade.SetDeviationInPoints(InpSlippagePoints);
   g_trade.SetTypeFillingBySymbol(_Symbol);
   g_lastEntry = LastEntryTime();
   // au chargement, on attend la prochaine bougie : la dernière close a peut-être déjà été tradée avant un redémarrage
   g_lastBar = iTime(_Symbol, InpTimeframe, 0);
   // sorties forcées vérifiées aussi sans tick (clôture anticipée, marché qui s'endort avant l'heure de mise à plat)
   EventSetTimer(30);
   return INIT_SUCCEEDED;
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   EventKillTimer();
   Release(g_hFast);
   Release(g_hSlow);
   Release(g_hTrend);
   Release(g_hBB);
   Release(g_hBBWide);
   Release(g_hRSI);
   Release(g_hATR);
   Release(g_hADX);
   if(MQLInfoInteger(MQL_TESTER))
     {
      CloseStatDay();
      if(g_statDays > 0)
         PrintFormat("Quota : %d jours de session, minimum de %d atteint %d jours (%.0f %%), plafond de %d atteint %d jours (%.0f %%).",
                     g_statDays, InpMinTradesPerDay, g_statDaysMin, 100.0 * g_statDaysMin / g_statDays,
                     InpMaxTradesPerDay, g_statDaysCapped, 100.0 * g_statDaysCapped / g_statDays);
     }
   Comment("");
  }

void Release(int &handle)
  {
   if(handle != INVALID_HANDLE)
      IndicatorRelease(handle);
   handle = INVALID_HANDLE;
  }

//+------------------------------------------------------------------+
void OnTimer()
  {
   MqlDateTime now;
   TimeToStruct(TimeCurrent(), now);
   ForcedExit(now);
  }

// minutes avant la fin de la séance de trading en cours, d'après les horaires du broker (-1 : séance inconnue, ou qui
// se poursuit sans coupure le lendemain)
int MinutesToSessionEnd(const MqlDateTime &now)
  {
   int secs = now.hour * 3600 + now.min * 60 + now.sec;
   datetime from = 0, to = 0;
   for(uint i = 0; i < 16; i++)
     {
      if(!SymbolInfoSessionTrade(_Symbol, (ENUM_DAY_OF_WEEK)now.day_of_week, i, from, to))
         break;
      int f = (int)from, t = (int)MathMin((double)to, 86400.0);
      if(secs < f || secs >= t)
         continue;
      // une séance qui va jusqu'à minuit ne continue que si le lendemain en ouvre une à 0 h
      if(t >= 86340)
        {
         datetime nf = 0, nt = 0;
         if(SymbolInfoSessionTrade(_Symbol, (ENUM_DAY_OF_WEEK)((now.day_of_week + 1) % 7), 0, nf, nt) && (int)nf == 0)
            return -1;
        }
      return (t - secs) / 60;
     }
   return -1;
  }

// plus d'entrée : heure de mise à plat, vendredi soir, ou fin de séance du broker toute proche
bool NoEntryTime(const MqlDateTime &now)
  {
   if(now.hour >= InpFlatHour || (now.day_of_week == 5 && now.hour >= InpFridayFlatHour))
      return true;
   if(InpCloseBeforeEnd > 0)
     {
      int left = MinutesToSessionEnd(now);
      if(left >= 0 && left <= InpCloseBeforeEnd)
         return true;
     }
   return false;
  }

// ferme notre position à l'heure de mise à plat, avant la fin de séance, si elle date d'un jour serveur précédent
// (clôture anticipée, jour férié, terminal déconnecté au moment de la mise à plat), ou à la première bougie qui
// s'ouvre InpMaxHoldMinutes après celle de l'entrée (sortie au temps, à la clôture de bougie comme dans le labo) ;
// true si une position est ouverte et qu'il faut la fermer
bool ForcedExit(const MqlDateTime &now)
  {
   ulong ticket = 0;
   if(!SelectOurPosition(ticket))
      return false;
   datetime opened = (datetime)PositionGetInteger(POSITION_TIME);
   bool stale = DayStart(opened) < DayStart(TimeCurrent());
   bool timeUp = false;
   if(InpMaxHoldMinutes > 0)
     {
      datetime bar = iTime(_Symbol, InpTimeframe, 0);
      datetime entryBar = iTime(_Symbol, InpTimeframe, iBarShift(_Symbol, InpTimeframe, opened));
      timeUp = bar > 0 && entryBar > 0 && (long)(bar - entryBar) >= (long)InpMaxHoldMinutes * 60;
      // le labo ne rentre pas sur la bougie d'une sortie au temps : cette bougie ne sera pas traitée par OnTick
      if(timeUp)
         g_lastBar = bar;
     }
   if(!stale && !timeUp && !NoEntryTime(now))
      return false;
   // or fermé plus tôt que le forex (jour férié) : le serveur répond « marché fermé ». Sans nouveau prix de l'or, on
   // ne réessaie que toutes les 5 minutes ; au premier prix de la reprise, on réessaie tout de suite.
   static datetime lastRefusal = 0, lastRefusalQuote = 0;
   datetime quote = (datetime)SymbolInfoInteger(_Symbol, SYMBOL_TIME);
   if(quote <= lastRefusalQuote && (long)(TimeCurrent() - lastRefusal) < 300)
      return true;
   if(!g_trade.PositionClose(ticket))
     {
      lastRefusal = TimeCurrent();
      lastRefusalQuote = quote;
      PrintFormat("Fermeture forcée refusée : %d %s", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription());
     }
   return true;
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   MqlDateTime now;
   TimeToStruct(TimeCurrent(), now);

   // sorties forcées : à chaque tick, pas seulement à la nouvelle bougie
   if(ForcedExit(now))
      return;

   datetime bar = iTime(_Symbol, InpTimeframe, 0);
   if(bar == 0 || bar == g_lastBar)
      return;
   // pic de spread au premier tick : on réessaie pendant une minute plutôt que de perdre le signal de la bougie
   if(InpMaxSpread > 0 && SymbolInfoDouble(_Symbol, SYMBOL_ASK) - SymbolInfoDouble(_Symbol, SYMBOL_BID) > InpMaxSpread &&
      (long)(TimeCurrent() - bar) < 60)
      return;
   g_lastBar = bar;
   ulong ticket = 0;

   int today = TradesToday();
   TrackStatDay(now, today);
   ShowStatus(today);

   // sortie au croisement inverse
   if(InpExitOnCross && SelectOurPosition(ticket))
     {
      int cross = RawEmaCross();
      long type = PositionGetInteger(POSITION_TYPE);
      if((type == POSITION_TYPE_BUY && cross == -1) || (type == POSITION_TYPE_SELL && cross == 1))
        {
         g_trade.PositionClose(ticket);
         return; // pas de retournement sur la même bougie
        }
     }

   if(SelectOurPosition(ticket))
      return; // une position à la fois
   if(NoEntryTime(now) || now.hour < InpSessionStart || now.hour >= InpSessionEnd)
      return;
   if(today >= InpMaxTradesPerDay)
      return;
   if(InpMinMinutesApart > 0 && (long)(TimeCurrent() - g_lastEntry) < (long)InpMinMinutesApart * 60)
      return;
   if(InpDailyLossPct > 0 && DailyLossHit())
      return;
   if(InpMaxSpread > 0 && SymbolInfoDouble(_Symbol, SYMBOL_ASK) - SymbolInfoDouble(_Symbol, SYMBOL_BID) > InpMaxSpread)
      return;

   double tp = 0;
   bool catchUp = false;
   int dir = PrimarySignal(tp);
   if(dir == 0 && InpCatchUpMode != MABB_CATCHUP_OFF && now.hour >= InpCatchUpHour && today < InpMinTradesPerDay)
     {
      dir = CatchUpSignal(tp);
      catchUp = (dir != 0);
     }
   if(dir != 0)
      Enter(dir, tp, catchUp);
  }

//+------------------------------------------------------------------+
//| Signaux, lus sur les bougies CLOSES (1 = dernière close)         |
//+------------------------------------------------------------------+
double Buf(const int handle, const int buffer, const int shift)
  {
   double v[1];
   if(handle == INVALID_HANDLE || CopyBuffer(handle, buffer, shift, 1, v) != 1)
      return EMPTY_VALUE;
   return v[0];
  }

bool Valid(const double v) { return v != EMPTY_VALUE && v != 0.0 && MathIsValidNumber(v); }

// +1 croisement haussier de l'EMA rapide sur la lente à la dernière bougie close, -1 baissier, 0 rien
int RawEmaCross()
  {
   double f1 = Buf(g_hFast, 0, 1), f2 = Buf(g_hFast, 0, 2), s1 = Buf(g_hSlow, 0, 1), s2 = Buf(g_hSlow, 0, 2);
   if(!Valid(f1) || !Valid(f2) || !Valid(s1) || !Valid(s2))
      return 0;
   return (f2 <= s2 && f1 > s1) ? 1 : (f2 >= s2 && f1 < s1) ? -1 : 0;
  }

// croisement filtré : EMA de tendance (si demandée), puis ADX ; le rattrapage passe withTrendFilter = false
int EmaCross(const bool withTrendFilter)
  {
   int dir = RawEmaCross();
   if(dir == 0)
      return 0;
   if(withTrendFilter && g_hTrend != INVALID_HANDLE)
     {
      double t1 = Buf(g_hTrend, 0, 1), c1 = iClose(_Symbol, InpTimeframe, 1);
      if(!Valid(t1) || !((dir == 1 && c1 > t1) || (dir == -1 && c1 < t1)))
         return 0;
     }
   if(InpADXMin > 0 || InpADXUseDI)
     {
      double adx = Buf(g_hADX, MAIN_LINE, 1), pdi = Buf(g_hADX, PLUSDI_LINE, 1), ndi = Buf(g_hADX, MINUSDI_LINE, 1);
      if(adx == EMPTY_VALUE || pdi == EMPTY_VALUE || ndi == EMPTY_VALUE)
         return 0;
      if(InpADXMin > 0 && adx < InpADXMin)
         return 0;
      if(InpADXUseDI && ((dir == 1 && pdi <= ndi) || (dir == -1 && ndi <= pdi)))
         return 0;
     }
   return dir;
  }

// retour à la moyenne : clôture hors bande puis retour dedans, RSI extrême sur la bougie hors bande ; TP = médiane
int BBReversion(const int bbHandle, const double rsiExtreme, double &tp)
  {
   double c1 = iClose(_Symbol, InpTimeframe, 1), c2 = iClose(_Symbol, InpTimeframe, 2);
   double up1 = Buf(bbHandle, UPPER_BAND, 1), up2 = Buf(bbHandle, UPPER_BAND, 2);
   double lo1 = Buf(bbHandle, LOWER_BAND, 1), lo2 = Buf(bbHandle, LOWER_BAND, 2);
   double mid1 = Buf(bbHandle, BASE_LINE, 1), rsi2 = Buf(g_hRSI, 0, 2);
   if(!Valid(up1) || !Valid(up2) || !Valid(lo1) || !Valid(lo2) || !Valid(mid1) || !Valid(rsi2))
      return 0;
   tp = mid1;
   if(c2 < lo2 && c1 > lo1 && rsi2 < rsiExtreme)
      return 1;
   if(c2 > up2 && c1 < up1 && rsi2 > 100.0 - rsiExtreme)
      return -1;
   return 0;
  }

// cassure : la clôture sort de la bande, dans le sens de l'EMA de tendance
int BBBreakout()
  {
   double c1 = iClose(_Symbol, InpTimeframe, 1), c2 = iClose(_Symbol, InpTimeframe, 2);
   double up1 = Buf(g_hBB, UPPER_BAND, 1), up2 = Buf(g_hBB, UPPER_BAND, 2);
   double lo1 = Buf(g_hBB, LOWER_BAND, 1), lo2 = Buf(g_hBB, LOWER_BAND, 2);
   if(!Valid(up1) || !Valid(up2) || !Valid(lo1) || !Valid(lo2))
      return 0;
   bool filter = (g_hTrend != INVALID_HANDLE);
   double t1 = filter ? Buf(g_hTrend, 0, 1) : 0;
   if(filter && !Valid(t1))
      return 0;
   bool trendUp = !filter || c1 > t1, trendDn = !filter || c1 < t1;
   if(c2 <= up2 && c1 > up1 && trendUp)
      return 1;
   if(c2 >= lo2 && c1 < lo1 && trendDn)
      return -1;
   return 0;
  }

// tp = 0 : TP calculé au ratio ; tp > 0 : TP imposé par le signal (médiane de Bollinger)
int PrimarySignal(double &tp)
  {
   tp = 0;
   switch(InpSignalMode)
     {
      case MABB_EMA_CROSS:
         return EmaCross(true);
      case MABB_BB_REVERSION:
         return BBReversion(g_hBB, InpRSIExtreme, tp);
      case MABB_BB_BREAKOUT:
         return BBBreakout();
      case MABB_EMA_OR_BB:
        {
         int d = EmaCross(true);
         if(d != 0)
            return d;
         return BBReversion(g_hBB, InpRSIExtreme, tp);
        }
     }
   return 0;
  }

int CatchUpSignal(double &tp)
  {
   tp = 0;
   if(InpCatchUpMode == MABB_CATCHUP_EMA_NO_FILTER)
      return EmaCross(false);
   if(InpCatchUpMode == MABB_CATCHUP_BB_WIDE)
      return BBReversion(g_hBBWide, InpCatchUpRSI, tp);
   return 0;
  }

//+------------------------------------------------------------------+
//| Exécution                                                        |
//+------------------------------------------------------------------+
void Enter(const int dir, const double signalTp, const bool catchUp)
  {
   double atr = Buf(g_hATR, 0, 1);
   if(!Valid(atr))
      return;
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK), bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double entry = (dir == 1) ? ask : bid;
   double slDist = InpStopATR * atr;
   double sl = entry - dir * slDist;
   double tp = (signalTp > 0) ? signalTp : entry + dir * InpRewardRisk * slDist;
   // un TP de retour à la moyenne trop proche (ou déjà dépassé) ne paie pas le spread : on passe
   if(signalTp > 0 && (tp - entry) * dir < 0.3 * atr)
      return;
   double minDist = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   if(MathAbs(entry - sl) <= minDist || MathAbs(tp - entry) <= minDist)
      return;
   sl = NormalizePrice(sl);
   tp = NormalizePrice(tp);

   double lots = LotsForRisk(MathAbs(entry - sl));
   if(lots <= 0)
     {
      PrintFormat("Lot sous le minimum du broker (lot fixe %.2f, risque %.2f %%, stop %.2f) : entrée ignorée.", InpFixedLots, InpRiskPercent, slDist);
      return;
     }
   ENUM_ORDER_TYPE type = (dir == 1) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   double margin = 0;
   if(OrderCalcMargin(type, _Symbol, lots, entry, margin) && margin > AccountInfoDouble(ACCOUNT_MARGIN_FREE))
     {
      Print("Marge libre insuffisante : entrée ignorée.");
      return;
     }
   string comment = catchUp ? "MABB rattrapage" : "MABB";
   bool ok = (dir == 1) ? g_trade.Buy(lots, _Symbol, 0, sl, tp, comment) : g_trade.Sell(lots, _Symbol, 0, sl, tp, comment);
   if(ok && (g_trade.ResultRetcode() == TRADE_RETCODE_DONE || g_trade.ResultRetcode() == TRADE_RETCODE_PLACED))
     {
      g_lastEntry = TimeCurrent();
      g_statDayTrades++; // le bilan du testeur compte aussi une entrée prise sur la dernière bougie avant une clôture
     }
   else
      PrintFormat("Ordre refusé : %d %s", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription());
  }

double NormalizePrice(const double price)
  {
   double tick = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tick <= 0)
      return NormalizeDouble(price, _Digits);
   return NormalizeDouble(MathRound(price / tick) * tick, _Digits);
  }

double LotsForRisk(const double slDist)
  {
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN), vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double lots = InpFixedLots;
   if(lots <= 0)
     {
      double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
      double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
      if(tickValue <= 0)
         tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
      if(tickSize <= 0 || tickValue <= 0 || slDist <= 0)
         return 0;
      double lossPerLot = slDist / tickSize * tickValue;
      lots = AccountInfoDouble(ACCOUNT_EQUITY) * InpRiskPercent / 100.0 / lossPerLot;
     }
   if(step <= 0)
      step = 0.01;
   lots = MathFloor(lots / step + 1e-9) * step; // arrondi vers le bas : jamais plus que le risque demandé
   if(lots < vmin)
      return 0;
   lots = MathMin(lots, vmax);
   int digits = (int)MathMax(0, MathCeil(-MathLog10(step) - 1e-9));
   return NormalizeDouble(lots, digits);
  }

//+------------------------------------------------------------------+
//| Positions et historique de CET EA sur CE symbole                 |
//+------------------------------------------------------------------+
bool SelectOurPosition(ulong &ticket)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0)
         continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol && (ulong)PositionGetInteger(POSITION_MAGIC) == InpMagic)
        {
         ticket = t;
         return true;
        }
     }
   ticket = 0;
   return false;
  }

datetime DayStart(const datetime t) { return (datetime)((long)t - (long)t % 86400); }

// compté dans l'historique du serveur : survit à un redémarrage du terminal ou de l'EA. Une entrée exécutée en
// plusieurs morceaux donne plusieurs deals d'entrée pour la même position : on compte les positions, pas les deals.
int TradesToday()
  {
   if(!HistorySelect(DayStart(TimeCurrent()), TimeCurrent() + 60))
      return 0;
   ulong seen[];
   int n = 0;
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
     {
      ulong d = HistoryDealGetTicket(i);
      if(HistoryDealGetString(d, DEAL_SYMBOL) != _Symbol || (ulong)HistoryDealGetInteger(d, DEAL_MAGIC) != InpMagic ||
         HistoryDealGetInteger(d, DEAL_ENTRY) != DEAL_ENTRY_IN)
         continue;
      ulong id = (ulong)HistoryDealGetInteger(d, DEAL_POSITION_ID);
      bool dup = false;
      for(int k = 0; k < n && !dup; k++)
         dup = (seen[k] == id);
      if(dup)
         continue;
      ArrayResize(seen, n + 1);
      seen[n++] = id;
     }
   return n;
  }

datetime LastEntryTime()
  {
   if(!HistorySelect(DayStart(TimeCurrent()), TimeCurrent() + 60))
      return 0;
   datetime last = 0;
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
     {
      ulong d = HistoryDealGetTicket(i);
      if(HistoryDealGetString(d, DEAL_SYMBOL) == _Symbol && (ulong)HistoryDealGetInteger(d, DEAL_MAGIC) == InpMagic &&
         HistoryDealGetInteger(d, DEAL_ENTRY) == DEAL_ENTRY_IN)
        {
         datetime t = (datetime)HistoryDealGetInteger(d, DEAL_TIME);
         if(t > last)
            last = t;
        }
     }
   return last;
  }

// perte du jour (clôturé + latent) au-delà de InpDailyLossPct du solde de début de journée
bool DailyLossHit()
  {
   double closed = 0;
   if(HistorySelect(DayStart(TimeCurrent()), TimeCurrent() + 60))
      for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
        {
         ulong d = HistoryDealGetTicket(i);
         if(HistoryDealGetString(d, DEAL_SYMBOL) != _Symbol || (ulong)HistoryDealGetInteger(d, DEAL_MAGIC) != InpMagic)
            continue;
         closed += HistoryDealGetDouble(d, DEAL_PROFIT) + HistoryDealGetDouble(d, DEAL_SWAP) + HistoryDealGetDouble(d, DEAL_COMMISSION);
        }
   double floating = 0;
   ulong ticket;
   if(SelectOurPosition(ticket))
      floating = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
   double startBalance = AccountInfoDouble(ACCOUNT_BALANCE) - closed;
   return startBalance > 0 && closed + floating <= -startBalance * InpDailyLossPct / 100.0;
  }

//+------------------------------------------------------------------+
//| Affichage et bilan du quota                                      |
//+------------------------------------------------------------------+
void ShowStatus(const int today)
  {
   if(MQLInfoInteger(MQL_TESTER) && !MQLInfoInteger(MQL_VISUAL_MODE))
      return;
   string modes[] = {"EMA cross", "BB retour moyenne", "BB cassure", "EMA ou BB"};
   Comment(StringFormat("Algoria XAU MABB — %s\nTrades aujourd'hui : %d (min %d, max %d)%s",
                        modes[(int)InpSignalMode], today, InpMinTradesPerDay, InpMaxTradesPerDay,
                        today >= InpMaxTradesPerDay ? "\nPlafond atteint : plus d'entrée aujourd'hui" : ""));
  }

void CloseStatDay()
  {
   if(g_statDay < 0)
      return;
   g_statDays++;
   if(g_statDayTrades >= InpMinTradesPerDay)
      g_statDaysMin++;
   if(g_statDayTrades >= InpMaxTradesPerDay)
      g_statDaysCapped++;
  }

// un jour compte dès qu'une bougie de session y est vue
void TrackStatDay(const MqlDateTime &now, const int today)
  {
   if(!MQLInfoInteger(MQL_TESTER))
      return;
   int day = (int)((long)TimeCurrent() / 86400);
   if(day != g_statDay)
     {
      if(now.hour < InpSessionStart || now.hour >= InpSessionEnd)
         return;
      CloseStatDay();
      g_statDay = day;
     }
   g_statDayTrades = today;
  }
//+------------------------------------------------------------------+
