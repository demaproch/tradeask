/** Configuration de la stratégie Momentum RSI. */

// --- Paires tradées (format ccxt swap Binance) ---
export const SYMBOLS: string[] = [
  "BTC/USDT:USDT",
  "ETH/USDT:USDT",
  "SOL/USDT:USDT",
  "AVAX/USDT:USDT",
  "SUI/USDT:USDT",
];

// --- Timeframe ---
export const DEFAULT_TIMEFRAME = "5m";
export const TIMEFRAMES: readonly string[] = ["1m", "3m", "5m", "15m", "30m", "1h", "4h"];

// --- Capital / money management ---
export const INITIAL_CAPITAL = 1000.0; // $ (simulé)
export const RISK_PCT = 0.08; // 8 % du capital risqué par trade -> marge engagée
export const LEVERAGE = 10; // levier utilisé
export const MAX_LEVERAGE = 12; // plafond de levier

// --- Signal ---
export const LOOKBACK_CANDLES = 10; // variation calculée sur les 10 dernières bougies
export const VARIATION_THRESHOLD = 0.0055; // +/- 0,55 %
export const RSI_PERIOD = 6;
export const RSI_LONG_THRESHOLD = 52; // LONG si RSI > 52
export const RSI_SHORT_THRESHOLD = 48; // SHORT si RSI < 48

// --- Sorties (sur le prix, exposition notionnelle) ---
export const TAKE_PROFIT_PCT = 0.028; // +2,8 %
export const STOP_LOSS_PCT = -0.01; // -1,0 %

// --- Exécution ---
export const POLL_INTERVAL_SEC = 50; // cycle toutes les ~50 secondes
export const COOLDOWN_SEC = 5 * 60; // 5 minutes entre deux trades sur le même symbole

// --- Exchange ---
export const EXCHANGE_ID = "binanceusdm"; // Binance Futures (testnet possible via env)
export const USE_TESTNET = false; // True pour utiliser le testnet futures
