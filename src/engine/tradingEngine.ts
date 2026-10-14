import { Candle, TrendDirection, WatchlistEntry, ScreenerTag, FairValueGap, ZoneMap, TradePlan, Position, TradeRecord, AuditReport, DeskRules, LogEntry } from '../types';

// ============ DESK RULES ============
export const DEFAULT_RULES: DeskRules = {
  market: 'USDT Perpetual Futures',
  direction: 'SHORT_ONLY',
  riskPerTrade: 1.0,
  addRisk: 0.5,
  staleThresholdHours: 72,
  thresholds: {
    minTrades: 40,
    minWinRate: 33,
    minExpectancy: 0.4,
    maxDrawdown: 20,
  },
};

// ============ SCREENER ============
// Three-candle rule for trend change detection
export function detectTrendChange(candles: Candle[], direction: 'short' | 'long'): TrendDirection {
  if (candles.length < 3) {
    console.log(`    ⚠️ detectTrendChange: pas assez de bougies (${candles.length} < 3)`);
    return 'NEUTRAL';
  }
  
  const c1 = candles[candles.length - 3];
  const c2 = candles[candles.length - 2];
  const c3 = candles[candles.length - 1];

  if (direction === 'short') {
    // C1 closes down (close < open)
    const c1Down = c1.close < c1.open;
    // C2 closes below C1's close; C2 does not take out C1's high
    const c2BelowC1 = c2.close < c1.close;
    const c2NotAboveC1High = c2.high <= c1.high;
    // C3 body closes below C2's close; C2 and C3 do not touch C1's high
    const c3BelowC2 = c3.close < c2.close;
    const neitherTouchesC1High = c2.high <= c1.high && c3.high <= c1.high;

    console.log(`    📊 Short check:`, {
      c1Down: `${c1.close.toFixed(2)} < ${c1.open.toFixed(2)} = ${c1Down}`,
      c2BelowC1: `${c2.close.toFixed(2)} < ${c1.close.toFixed(2)} = ${c2BelowC1}`,
      c2NotAboveC1High: `${c2.high.toFixed(2)} <= ${c1.high.toFixed(2)} = ${c2NotAboveC1High}`,
      c3BelowC2: `${c3.close.toFixed(2)} < ${c2.close.toFixed(2)} = ${c3BelowC2}`,
      neitherTouchesC1High: `${c2.high.toFixed(2)},${c3.high.toFixed(2)} <= ${c1.high.toFixed(2)} = ${neitherTouchesC1High}`,
    });

    if (c1Down && c2BelowC1 && c2NotAboveC1High && c3BelowC2 && neitherTouchesC1High) {
      console.log(`    ✅ BEARISH detected!`);
      return 'BEARISH';
    }
  } else {
    // Long: mirror logic
    const c1Up = c1.close > c1.open;
    const c2AboveC1 = c2.close > c1.close;
    const c2NotBelowC1Low = c2.low >= c1.low;
    const c3AboveC2 = c3.close > c2.close;
    const neitherTouchesC1Low = c2.low >= c1.low && c3.low >= c1.low;

    console.log(`    📊 Long check:`, {
      c1Up: `${c1.close.toFixed(2)} > ${c1.open.toFixed(2)} = ${c1Up}`,
      c2AboveC1: `${c2.close.toFixed(2)} > ${c1.close.toFixed(2)} = ${c2AboveC1}`,
      c2NotBelowC1Low: `${c2.low.toFixed(2)} >= ${c1.low.toFixed(2)} = ${c2NotBelowC1Low}`,
      c3AboveC2: `${c3.close.toFixed(2)} > ${c2.close.toFixed(2)} = ${c3AboveC2}`,
      neitherTouchesC1Low: `${c2.low.toFixed(2)},${c3.low.toFixed(2)} >= ${c1.low.toFixed(2)} = ${neitherTouchesC1Low}`,
    });

    if (c1Up && c2AboveC1 && c2NotBelowC1Low && c3AboveC2 && neitherTouchesC1Low) {
      console.log(`    ✅ BULLISH detected!`);
      return 'BULLISH';
    }
  }

  console.log(`    ❌ NEUTRAL - conditions non remplies`);
  return 'NEUTRAL';
}

export function isDailyFlippedDown(dailyCandles: Candle[]): boolean {
  return detectTrendChange(dailyCandles, 'short') === 'BEARISH';
}

export function isH4Bouncing(h4Candles: Candle[]): boolean {
  if (h4Candles.length < 3) return false;
  const recent = h4Candles.slice(-3);
  // Bouncing = higher lows or bullish momentum
  return recent[2].close > recent[0].close && recent[1].low <= recent[0].low;
}

export function runScreener(
  coins: { symbol: string; dailyCandles: Candle[]; h4Candles: Candle[] }[],
  rules: DeskRules
): { watchlist: WatchlistEntry[]; logs: LogEntry[] } {
  const watchlist: WatchlistEntry[] = [];
  const logs: LogEntry[] = [];
  const now = Date.now();

  console.log(`🔍 Screener: analyse de ${coins.length} coins...`);

  for (const coin of coins) {
    const dailyTrend = detectTrendChange(coin.dailyCandles, 'short');
    const bullishTrend = detectTrendChange(coin.dailyCandles, 'long');

    console.log(`  ${coin.symbol}: daily=${dailyTrend}, bullish=${bullishTrend}, candles=${coin.dailyCandles.length}`);

    if (rules.direction === 'SHORT_ONLY' && dailyTrend === 'BEARISH') {
      const h4Bouncing = isH4Bouncing(coin.h4Candles);
      const tag: ScreenerTag = h4Bouncing ? 'PRIME' : 'STANDARD';
      const anchorHigh = Math.max(...coin.dailyCandles.slice(-10).map(c => c.high));

      console.log(`  ✅ ${coin.symbol} → ${tag} (h4Bouncing=${h4Bouncing})`);

      watchlist.push({
        coin: coin.symbol,
        anchorHigh,
        flipDate: coin.dailyCandles[coin.dailyCandles.length - 3].timestamp,
        tag,
        direction: 'BEARISH',
        timestamp: now,
      });

      logs.push({
        timestamp: now,
        bot: 'Screener',
        message: `${coin.symbol} → ${tag} (daily flipped bearish${h4Bouncing ? ', 4H bouncing = PRIME' : ''})`,
        level: tag === 'PRIME' ? 'SUCCESS' : 'INFO',
      });
    } else if (bullishTrend === 'BULLISH') {
      console.log(`  ℹ️ ${coin.symbol} → bullish flip (context only)`);
      logs.push({
        timestamp: now,
        bot: 'Screener',
        message: `${coin.symbol} → bullish flip detected (logged as context only, never traded)`,
        level: 'INFO',
      });
    } else {
      console.log(`  ❌ ${coin.symbol} → pas de retournement détecté`);
    }
  }

  console.log(`✅ Screener terminé: ${watchlist.length} coins dans la watchlist`);
  return { watchlist, logs };
}

// ============ CARTOGRAPHER ============
// Fair Value Gap detection
export function findFVGs(candles: Candle[], coin: string): FairValueGap[] {
  const fvgs: FairValueGap[] = [];
  
  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c2 = candles[i - 1];
    const c3 = candles[i];

    // Bearish FVG: c1's low > c3's high (gap down)
    if (c1.low > c3.high) {
      fvgs.push({
        id: `fvg-${coin}-${i}-${Date.now()}`,
        coin,
        zoneTop: c1.low,
        zoneBottom: c3.high,
        status: 'OPEN',
        confirmed: false,
        createdAt: c2.timestamp,
      });
    }
    // Bullish FVG: c1's high < c3's low (gap up) - tracked but not traded
    if (c1.high < c3.low) {
      fvgs.push({
        id: `fvg-${coin}-${i}-${Date.now()}`,
        coin,
        zoneTop: c3.low,
        zoneBottom: c1.high,
        status: 'OPEN',
        confirmed: false,
        createdAt: c2.timestamp,
      });
    }
  }

  return fvgs;
}

export function checkZoneTested(zones: FairValueGap[], currentPrice: number): FairValueGap[] {
  return zones.map(zone => {
    if (zone.status === 'OPEN') {
      // Partial wick test counts
      const touched = currentPrice >= zone.zoneBottom && currentPrice <= zone.zoneTop;
      if (touched) {
        return { ...zone, status: 'TESTED' as const, testedAt: Date.now() };
      }
    }
    if (zone.status === 'TESTED') {
      // Check if fully filled
      if (currentPrice < zone.zoneBottom || currentPrice > zone.zoneTop) {
        return { ...zone, status: 'FILLED' as const };
      }
    }
    return zone;
  });
}

export function runCartographer(
  watchlist: WatchlistEntry[],
  h4Data: Map<string, Candle[]>,
  h1Data: Map<string, Candle[]>,
  currentPrices: Map<string, number>
): { zoneMaps: Map<string, ZoneMap>; logs: LogEntry[] } {
  const zoneMaps = new Map<string, ZoneMap>();
  const logs: LogEntry[] = [];
  const now = Date.now();

  for (const entry of watchlist) {
    const h4Candles = h4Data.get(entry.coin) || [];
    const h1Candles = h1Data.get(entry.coin) || [];
    const currentPrice = currentPrices.get(entry.coin) || 0;

    // Find FVGs across the full impulse
    const fvgs = findFVGs(h4Candles, entry.coin);
    
    // Check which zones are tested
    const updatedZones = checkZoneTested(fvgs, currentPrice);

    // Check 1H confirmation for tested zones
    const confirmedZones = updatedZones.map(zone => {
      if (zone.status === 'TESTED' && !zone.confirmed && h1Candles.length >= 2) {
        // Confirmation: 1H shows rejection at zone
        const lastH1 = h1Candles[h1Candles.length - 1];
        const prevH1 = h1Candles[h1Candles.length - 2];
        
        // For shorts: price rejected up from zone (wick above, close below)
        const rejected = lastH1.high >= zone.zoneBottom && lastH1.close < zone.zoneTop;
        if (rejected) {
          logs.push({
            timestamp: now,
            bot: 'Cartographer',
            message: `${entry.coin} zone [${zone.zoneBottom.toFixed(2)}-${zone.zoneTop.toFixed(2)}] confirmed on 1H`,
            level: 'SUCCESS',
          });
          return { ...zone, confirmed: true };
        }
      }
      return zone;
    });

    // Sort as ladder (top to bottom)
    const sorted = confirmedZones.sort((a, b) => b.zoneTop - a.zoneTop);

    zoneMaps.set(entry.coin, {
      coin: entry.coin,
      zones: sorted,
      lastUpdated: now,
    });

    logs.push({
      timestamp: now,
      bot: 'Cartographer',
      message: `${entry.coin}: mapped ${sorted.length} zones, ${sorted.filter(z => z.confirmed).length} confirmed`,
      level: 'INFO',
    });
  }

  return { zoneMaps, logs };
}

// ============ RISK OFFICER ============
export function calculatePositionSize(
  accountBalance: number,
  entry: number,
  stop: number,
  riskPct: number
): number {
  const riskAmount = accountBalance * (riskPct / 100);
  const stopDistance = Math.abs(entry - stop);
  if (stopDistance === 0) return 0;
  return riskAmount / stopDistance * entry;
}

export function runRiskOfficer(
  zoneMaps: Map<string, ZoneMap>,
  accountBalance: number,
  rules: DeskRules,
  existingPositions: Position[]
): { tradePlans: TradePlan[]; logs: LogEntry[] } {
  const tradePlans: TradePlan[] = [];
  const logs: LogEntry[] = [];
  const now = Date.now();

  for (const [coin, zoneMap] of zoneMaps) {
    const confirmedZones = zoneMap.zones.filter(z => z.confirmed && z.status === 'TESTED');
    
    for (const zone of confirmedZones) {
      // Check if we already have a position on this coin
      const existingPos = existingPositions.find(p => p.coin === coin && p.status === 'OPEN');
      const addNumber = existingPos ? existingPos.addNumber + 1 : 1;
      
      let riskPct: number;
      let rejectReason: string | undefined;

      if (addNumber === 1) {
        riskPct = rules.riskPerTrade;
      } else {
        // Can only add if previous entry is at breakeven
        if (existingPos && !existingPos.breakeven) {
          rejectReason = `Cannot add: previous position not at breakeven`;
          riskPct = 0;
          logs.push({
            timestamp: now,
            bot: 'Risk Officer',
            message: `${coin} add #${addNumber} REJECTED: previous not at breakeven`,
            level: 'WARN',
          });
          tradePlans.push({
            id: `tp-${coin}-${now}-${addNumber}`,
            coin,
            entry: zone.zoneTop,
            stop: zone.zoneTop * 1.02,
            size: 0,
            riskPct: 0,
            addNumber,
            status: 'REJECTED',
            rejectReason,
            timestamp: now,
          });
          continue;
        }
        riskPct = rules.addRisk;
      }

      const entry = zone.zoneTop;
      const stop = zone.zoneBottom < zone.zoneTop ? zone.zoneBottom : zone.zoneTop * 0.98;
      const size = calculatePositionSize(accountBalance, entry, stop, riskPct);

      tradePlans.push({
        id: `tp-${coin}-${now}-${addNumber}`,
        coin,
        entry,
        stop,
        size,
        riskPct,
        addNumber,
        status: 'APPROVED',
        timestamp: now,
      });

      logs.push({
        timestamp: now,
        bot: 'Risk Officer',
        message: `${coin} add #${addNumber}: size=${size.toFixed(2)} USDT, risk=${riskPct}%, entry=${entry.toFixed(2)}, stop=${stop.toFixed(2)}`,
        level: 'INFO',
      });
    }
  }

  return { tradePlans, logs };
}

// ============ EXIT CLERK ============
export interface ExitSignal {
  positionId: string;
  coin: string;
  reason: string;
  urgent: boolean;
}

export function runExitClerk(
  positions: Position[],
  currentPrices: Map<string, number>,
  dailyCloses: Map<string, number>,
  anchorHighs: Map<string, number>,
  rules: DeskRules,
  marketStates: Map<string, string>
): { exits: ExitSignal[]; staleFlags: string[]; logs: LogEntry[] } {
  const exits: ExitSignal[] = [];
  const staleFlags: string[] = [];
  const logs: LogEntry[] = [];
  const now = Date.now();

  for (const pos of positions) {
    if (pos.status !== 'OPEN') continue;

    const currentPrice = currentPrices.get(pos.coin) || pos.entry;
    const dailyClose = dailyCloses.get(pos.coin) || currentPrice;
    const anchorHigh = anchorHighs.get(pos.coin) || pos.entry * 1.05;
    const marketState = marketStates.get(pos.coin) || 'BEARISH';

    // Rule 1: Daily close above anchor → close immediately
    if (dailyClose > anchorHigh) {
      exits.push({
        positionId: pos.id,
        coin: pos.coin,
        reason: 'EXIT NOW: Daily close above anchor',
        urgent: true,
      });
      logs.push({
        timestamp: now,
        bot: 'Exit Clerk',
        message: `${pos.coin} → EXIT NOW: daily close (${dailyClose.toFixed(2)}) above anchor (${anchorHigh.toFixed(2)})`,
        level: 'ERROR',
      });
      continue;
    }

    // Rule 2: State flips to neutral while in profit → hold
    const pnl = pos.entry - currentPrice; // short position
    if (marketState === 'NEUTRAL' && pnl > 0) {
      logs.push({
        timestamp: now,
        bot: 'Exit Clerk',
        message: `${pos.coin} → state NEUTRAL while in profit → HOLD (don't cut winner)`,
        level: 'INFO',
      });
      continue;
    }

    // Rule 3: Stale check (72h flat)
    const hoursFlat = (now - pos.openedAt) / (1000 * 60 * 60);
    const pnlPct = Math.abs(pnl / pos.entry) * 100;
    if (hoursFlat >= rules.staleThresholdHours && pnlPct < 0.5) {
      staleFlags.push(pos.id);
      logs.push({
        timestamp: now,
        bot: 'Exit Clerk',
        message: `${pos.coin} → STALE flag: flat for ${hoursFlat.toFixed(0)}h, human decides`,
        level: 'WARN',
      });
    }
  }

  return { exits, staleFlags, logs };
}

// ============ AUDITOR ============
export function calculateResultInR(entry: number, exit: number, stop: number, isShort: boolean): number {
  const riskDistance = Math.abs(entry - stop);
  if (riskDistance === 0) return 0;
  const pnl = isShort ? entry - exit : exit - entry;
  return pnl / riskDistance;
}

export function runAuditor(
  trades: TradeRecord[],
  rules: DeskRules
): AuditReport {
  const totalTrades = trades.length;
  const winners = trades.filter(t => t.resultR > 0).length;
  const winRate = totalTrades > 0 ? (winners / totalTrades) * 100 : 0;
  
  // Expectancy = (winRate * avgWin) - (lossRate * avgLoss)
  const winningTrades = trades.filter(t => t.resultR > 0);
  const losingTrades = trades.filter(t => t.resultR <= 0);
  const avgWin = winningTrades.length > 0 ? winningTrades.reduce((sum, t) => sum + t.resultR, 0) / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0 ? Math.abs(losingTrades.reduce((sum, t) => sum + t.resultR, 0) / losingTrades.length) : 0;
  const expectancy = (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss;

  // Max drawdown from equity curve
  let peak = 0;
  let maxDD = 0;
  let equity = 0;
  const equityCurve: { timestamp: number; equity: number }[] = [{ timestamp: 0, equity: 0 }];
  
  for (const trade of trades.sort((a, b) => a.closedAt - b.closedAt)) {
    equity += trade.pnl;
    equityCurve.push({ timestamp: trade.closedAt, equity });
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  }

  const passed = 
    totalTrades >= rules.thresholds.minTrades &&
    winRate >= rules.thresholds.minWinRate &&
    expectancy >= rules.thresholds.minExpectancy &&
    maxDD <= rules.thresholds.maxDrawdown;

  return {
    totalTrades,
    winRate,
    expectancy,
    maxDrawdown: maxDD,
    equityCurve,
    passed,
    thresholds: rules.thresholds,
  };
}
