/** Logique pure de la stratégie : RSI, détection de signal, money management.
 *
 * Aucune dépendance à ccxt ici -> testable unitairement.
 */

export type Direction = "LONG" | "SHORT";
export type ExitReason = "TP" | "SL" | "MANUAL";

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface Signal {
  symbol: string;
  direction: Direction; // "LONG" | "SHORT"
  variation: number; // ex: 0.0072 pour +0,72 %
  rsi: number;
  price: number; // prix d'entrée (dernier close)
}

export interface Sizing {
  margin: number;
  notional: number;
  quantity: number;
}

export interface DetectSignalOptions {
  lookback?: number;
  variationThreshold?: number;
  rsiPeriod?: number;
  rsiLong?: number;
  rsiShort?: number;
}

export interface PositionSizingOptions {
  riskPct?: number;
  leverage?: number;
  maxLeverage?: number;
}

export interface CheckExitOptions {
  tpPct?: number;
  slPct?: number;
}

/** Moyenne simple d'un tableau de nombres. */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/** Les `period` derniers éléments de `values`. */
function tail(values: number[], period: number): number[] {
  return values.slice(Math.max(0, values.length - period));
}

/**
 * RSI classique (moyennes mobiles simples des gains/pertes).
 *
 * `closes` doit contenir au moins period + 1 valeurs.
 * Retourne le RSI sur la dernière bougie (0-100).
 */
export function computeRsi(closes: number[], period = 6): number {
  if (closes.length < period + 1) return 50.0;
  const deltas: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    deltas.push((closes[i] ?? 0) - (closes[i - 1] ?? 0));
  }
  const gains = deltas.map((d) => Math.max(d, 0));
  const losses = deltas.map((d) => Math.max(-d, 0));
  const avgGain = mean(tail(gains, period));
  const avgLoss = mean(tail(losses, period));
  if (avgLoss === 0) return avgGain > 0 ? 100.0 : 50.0;
  const rs = avgGain / avgLoss;
  return 100.0 - 100.0 / (1.0 + rs);
}

/**
 * Détecte un signal momentum sur les `lookback` dernières bougies.
 *
 * candles : liste triée du plus ancien au plus récent. On utilise les N
 * dernières bougies clôturées :
 *   variation = (close[-1] - close[-1-lookback]) / close[-1-lookback]
 * LONG  si variation > +seuil ET RSI > rsiLong
 * SHORT si variation < -seuil ET RSI < rsiShort
 */
export function detectSignal(
  symbol: string,
  candles: Candle[],
  options: DetectSignalOptions = {},
): Signal | null {
  const {
    lookback = 10,
    variationThreshold = 0.0055,
    rsiPeriod = 6,
    rsiLong = 52.0,
    rsiShort = 48.0,
  } = options;

  const closes = candles.map((c) => c.close);
  if (closes.length < lookback + 1) return null;

  const current = closes[closes.length - 1] ?? 0;
  const past = closes[closes.length - 1 - lookback] ?? 0;
  if (past <= 0) return null;
  const variation = (current - past) / past;
  const rsi = computeRsi(closes, rsiPeriod);

  if (variation > variationThreshold && rsi > rsiLong) {
    return { symbol, direction: "LONG", variation, rsi, price: current };
  }
  if (variation < -variationThreshold && rsi < rsiShort) {
    return { symbol, direction: "SHORT", variation, rsi, price: current };
  }
  return null;
}

/** Marge = riskPct x capital ; notionnel = marge x levier. */
export function positionSizing(
  capital: number,
  entryPrice: number,
  options: PositionSizingOptions = {},
): Sizing {
  const { riskPct = 0.08, leverage = 10.0, maxLeverage = 12.0 } = options;
  const lev = Math.min(leverage, maxLeverage);
  const margin = capital * riskPct;
  const notional = margin * lev;
  const quantity = entryPrice > 0 ? notional / entryPrice : 0.0;
  return { margin, notional, quantity };
}

/**
 * Vérifie TP/SL fixes sur la variation de prix (côté position).
 *
 * Retourne "TP", "SL" ou null.
 */
export function checkExit(
  entryPrice: number,
  quantity: number,
  side: Direction,
  currentPrice: number,
  options: CheckExitOptions = {},
): ExitReason | null {
  const { tpPct = 0.028, slPct = -0.01 } = options;
  if (entryPrice <= 0) return null;
  let change = (currentPrice - entryPrice) / entryPrice;
  if (side === "SHORT") change = -change;
  if (change >= tpPct) return "TP";
  if (change <= slPct) return "SL";
  return null;
}

/** PnL non réalisé en $ (USDT) sur la position. */
export function unrealizedPnl(
  entryPrice: number,
  quantity: number,
  side: Direction,
  currentPrice: number,
): number {
  const sign = side === "LONG" ? 1.0 : -1.0;
  return sign * (currentPrice - entryPrice) * quantity;
}
