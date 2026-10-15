import { Candle, CoinData } from '../types';

const COINS = ['BTC', 'ETH', 'SOL', 'AVAX', 'DOGE', 'LINK', 'MATIC', 'ARB', 'OP', 'APT', 'SUI', 'INJ'];

const BASE_PRICES: Record<string, number> = {
  BTC: 67500,
  ETH: 3450,
  SOL: 178,
  AVAX: 38.5,
  DOGE: 0.165,
  LINK: 14.8,
  MATIC: 0.72,
  ARB: 1.15,
  OP: 2.85,
  APT: 9.2,
  SUI: 1.45,
  INJ: 28.5,
};

function generateCandleSequence(
  startPrice: number,
  count: number,
  volatility: number,
  trend: number,
  intervalMs: number,
  startTime: number
): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;

  for (let i = 0; i < count; i++) {
    const timestamp = startTime + i * intervalMs;
    const change = (Math.random() - 0.5 + trend * 0.1) * volatility * price;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * volatility * price * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * price * 0.5;
    const volume = Math.random() * 1000000 + 500000;

    candles.push({ timestamp, open, high, low, close, volume });
    price = close;
  }

  return candles;
}

// Generate a bearish trend change scenario for some coins
function generateBearishScenario(startPrice: number, baseTime: number): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  const vol = 0.015;

  // Pre-trend: slight uptrend (10 candles)
  for (let i = 0; i < 10; i++) {
    const ts = baseTime + i * 86400000;
    const open = price;
    const close = price + Math.random() * vol * price;
    const high = close + Math.random() * vol * price * 0.3;
    const low = open - Math.random() * vol * price * 0.3;
    candles.push({ timestamp: ts, open, high, low, close, volume: Math.random() * 1e6 });
    price = close;
  }

  // The three-candle bearish flip
  const anchorHigh = price;
  // C1: closes down
  const c1Open = price;
  const c1Close = price * (1 - vol * 1.5);
  const c1High = price * (1 + vol * 0.2);
  const c1Low = c1Close * (1 - vol * 0.3);
  candles.push({
    timestamp: baseTime + 10 * 86400000,
    open: c1Open, high: c1High, low: c1Low, close: c1Close,
    volume: Math.random() * 2e6,
  });

  // C2: closes below C1's close, doesn't take out C1's high
  const c2Open = c1Close * (1 + vol * 0.3);
  const c2Close = c1Close * (1 - vol * 0.8);
  const c2High = c1High * 0.95; // below C1 high
  const c2Low = c2Close * (1 - vol * 0.4);
  candles.push({
    timestamp: baseTime + 11 * 86400000,
    open: c2Open, high: c2High, low: c2Low, close: c2Close,
    volume: Math.random() * 2e6,
  });

  // C3: body closes below C2's close, neither touches C1's high
  const c3Open = c2Close * (1 + vol * 0.2);
  const c3Close = c2Close * (1 - vol * 0.6);
  const c3High = c2High * 0.97; // below C1 high
  const c3Low = c3Close * (1 - vol * 0.3);
  candles.push({
    timestamp: baseTime + 12 * 86400000,
    open: c3Open, high: c3High, low: c3Low, close: c3Close,
    volume: Math.random() * 2e6,
  });

  price = c3Close;

  // Post-trend: continuation down with some bounces (for FVG creation)
  for (let i = 0; i < 8; i++) {
    const ts = baseTime + (13 + i) * 86400000;
    const open = price;
    const direction = Math.random() > 0.4 ? -1 : 1;
    const change = direction * Math.random() * vol * price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * vol * price * 0.4;
    const low = Math.min(open, close) - Math.random() * vol * price * 0.4;
    candles.push({ timestamp: ts, open, high, low, close, volume: Math.random() * 1e6 });
    price = close;
  }

  return candles;
}

// Generate bullish scenario (for context logging)
function generateBullishScenario(startPrice: number, baseTime: number): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  const vol = 0.012;

  // Pre-trend: downtrend
  for (let i = 0; i < 10; i++) {
    const ts = baseTime + i * 86400000;
    const open = price;
    const close = price - Math.random() * vol * price;
    const high = open + Math.random() * vol * price * 0.3;
    const low = close - Math.random() * vol * price * 0.3;
    candles.push({ timestamp: ts, open, high, low, close, volume: Math.random() * 1e6 });
    price = close;
  }

  // Three-candle bullish flip
  const c1Open = price;
  const c1Close = price * (1 + vol * 1.5);
  candles.push({
    timestamp: baseTime + 10 * 86400000,
    open: c1Open, high: c1Close * 1.002, low: c1Open * 0.998, close: c1Close,
    volume: Math.random() * 2e6,
  });

  const c2Open = c1Close * (1 - vol * 0.2);
  const c2Close = c1Close * (1 + vol * 0.8);
  candles.push({
    timestamp: baseTime + 11 * 86400000,
    open: c2Open, high: c2Close * 1.001, low: c1Close * 0.999, close: c2Close,
    volume: Math.random() * 2e6,
  });

  const c3Open = c2Close * (1 - vol * 0.1);
  const c3Close = c2Close * (1 + vol * 0.6);
  candles.push({
    timestamp: baseTime + 12 * 86400000,
    open: c3Open, high: c3Close * 1.001, low: c2Close * 0.999, close: c3Close,
    volume: Math.random() * 2e6,
  });

  price = c3Close;

  for (let i = 0; i < 8; i++) {
    const ts = baseTime + (13 + i) * 86400000;
    const open = price;
    const change = Math.random() * vol * price;
    const close = price + change;
    const high = close + Math.random() * vol * price * 0.3;
    const low = open - Math.random() * vol * price * 0.3;
    candles.push({ timestamp: ts, open, high, low, close, volume: Math.random() * 1e6 });
    price = close;
  }

  return candles;
}

export function generateMarketData(): Map<string, CoinData> {
  const data = new Map<string, CoinData>();
  const now = Date.now();
  const baseTime = now - 20 * 86400000; // 20 days ago

  // Coins that will show bearish flip (short candidates)
  const bearishCoins = ['BTC', 'ETH', 'SOL', 'AVAX', 'LINK', 'ARB'];
  // Coins that will show bullish flip (context only)
  const bullishCoins = ['DOGE', 'SUI', 'INJ'];
  // Neutral coins
  const neutralCoins = ['MATIC', 'OP', 'APT'];

  for (const coin of COINS) {
    const basePrice = BASE_PRICES[coin];
    let dailyCandles: Candle[];

    if (bearishCoins.includes(coin)) {
      dailyCandles = generateBearishScenario(basePrice, baseTime);
    } else if (bullishCoins.includes(coin)) {
      dailyCandles = generateBullishScenario(basePrice, baseTime);
    } else {
      dailyCandles = generateCandleSequence(basePrice, 20, 0.02, 0, 86400000, baseTime);
    }

    // Generate 4H candles (4 per day × 20 days = 80)
    const h4Candles = generateCandleSequence(
      dailyCandles[0].open,
      80,
      0.008,
      bearishCoins.includes(coin) ? -0.3 : bullishCoins.includes(coin) ? 0.3 : 0,
      4 * 3600000,
      baseTime
    );

    // Generate 1H candles (24 per day × 5 recent days = 120)
    const h1Candles = generateCandleSequence(
      h4Candles[h4Candles.length - 20]?.open || basePrice,
      120,
      0.004,
      bearishCoins.includes(coin) ? -0.2 : 0,
      3600000,
      now - 5 * 86400000
    );

    data.set(coin, { symbol: coin, dailyCandles, h4Candles, h1Candles });
  }

  return data;
}

export function getCurrentPrices(marketData: Map<string, CoinData>): Map<string, number> {
  const prices = new Map<string, number>();
  for (const [coin, data] of marketData) {
    const lastCandle = data.h1Candles[data.h1Candles.length - 1];
    prices.set(coin, lastCandle?.close || BASE_PRICES[coin]);
  }
  return prices;
}

export function getCOINS() {
  return COINS;
}
