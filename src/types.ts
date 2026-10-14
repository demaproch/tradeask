// Core types for the trading desk

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CoinData {
  symbol: string;
  dailyCandles: Candle[];
  h4Candles: Candle[];
  h1Candles: Candle[];
}

// Screener types
export type TrendDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type ScreenerTag = 'PRIME' | 'STANDARD' | 'NONE';

export interface WatchlistEntry {
  coin: string;
  anchorHigh: number;
  flipDate: number;
  tag: ScreenerTag;
  direction: TrendDirection;
  timestamp: number;
}

// Cartographer types
export interface FairValueGap {
  id: string;
  coin: string;
  zoneTop: number;
  zoneBottom: number;
  status: 'OPEN' | 'TESTED' | 'FILLED';
  confirmed: boolean;
  createdAt: number;
  testedAt?: number;
}

export interface ZoneMap {
  coin: string;
  zones: FairValueGap[];
  lastUpdated: number;
}

// Risk Officer types
export interface TradePlan {
  id: string;
  coin: string;
  entry: number;
  stop: number;
  size: number; // in USDT
  riskPct: number;
  addNumber: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectReason?: string;
  timestamp: number;
}

// Gate types
export type GateDecision = 'TAKEN' | 'SKIPPED' | 'PENDING';

export interface GateAlert {
  id: string;
  tradePlan: TradePlan;
  decision: GateDecision;
  sentAt: number;
  decidedAt?: number;
}

// Exit Clerk types
export interface Position {
  id: string;
  coin: string;
  entry: number;
  stop: number;
  size: number;
  riskPct: number;
  openedAt: number;
  addNumber: number;
  breakeven: boolean;
  currentPnl: number;
  currentPnlR: number;
  status: 'OPEN' | 'CLOSED' | 'STALE';
  closedAt?: number;
  exitReason?: string;
  exitPrice?: number;
  flatSince?: number;
}

// Auditor types
export interface TradeRecord {
  id: string;
  coin: string;
  entry: number;
  exit: number;
  size: number;
  fee: number;
  slippage: number;
  resultR: number;
  pnl: number;
  openedAt: number;
  closedAt: number;
  exitReason: string;
  wasSkipped: boolean;
}

export interface AuditReport {
  totalTrades: number;
  winRate: number;
  expectancy: number;
  maxDrawdown: number;
  equityCurve: { timestamp: number; equity: number }[];
  passed: boolean;
  thresholds: {
    minTrades: number;
    minWinRate: number;
    minExpectancy: number;
    maxDrawdown: number;
  };
}

// Bot status
export interface BotStatus {
  name: string;
  role: string;
  lastRun: number | null;
  status: 'IDLE' | 'RUNNING' | 'ERROR' | 'WAITING';
  output: string;
  alerts: number;
}

// Desk state
export interface DeskState {
  accountBalance: number;
  riskPerTrade: number;
  addRisk: number;
  watchlist: WatchlistEntry[];
  zoneMaps: Map<string, ZoneMap>;
  tradePlans: TradePlan[];
  alerts: GateAlert[];
  positions: Position[];
  trades: TradeRecord[];
  botStatuses: BotStatus[];
  auditReport: AuditReport | null;
  running: boolean;
  logs: LogEntry[];
}

export interface LogEntry {
  timestamp: number;
  bot: string;
  message: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
}

// Rules
export interface DeskRules {
  market: string;
  direction: 'SHORT_ONLY' | 'LONG_ONLY' | 'BOTH';
  riskPerTrade: number;
  addRisk: number;
  staleThresholdHours: number;
  thresholds: {
    minTrades: number;
    minWinRate: number;
    minExpectancy: number;
    maxDrawdown: number;
  };
}
