import { Candle, CoinData } from '../types';

// Binance API configuration
const BINANCE_BASE_URL = 'https://api.binance.com/api/v3';

// Mapping de nos symboles vers les paires Binance (USDT)
const COIN_MAP: Record<string, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
  AVAX: 'AVAXUSDT',
  DOGE: 'DOGEUSDT',
  LINK: 'LINKUSDT',
  MATIC: 'MATICUSDT',
  ARB: 'ARBUSDT',
  OP: 'OPUSDT',
  APT: 'APTUSDT',
  SUI: 'SUIUSDT',
  INJ: 'INJUSDT',
};

// Cache pour éviter de spammer l'API
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<any>>();
const CACHE_DURATION = 30000; // 30 secondes (Binance est plus permissif)

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_DURATION) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

// Fetch avec gestion d'erreurs et retry
async function fetchWithRetry(url: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      
      if (response.status === 429) {
        // Rate limit atteint, attendre avant de réessayer
        console.warn('Rate limit atteint, attente de 10 secondes...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        continue;
      }
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      // Attendre avant de réessayer (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
    }
  }
}

// Récupérer les prix actuels de tous les coins
export async function fetchCurrentPrices(): Promise<Map<string, number>> {
  const cacheKey = 'current-prices';
  const cached = getCached<Map<string, number>>(cacheKey);
  if (cached) return cached;

  try {
    const url = `${BINANCE_BASE_URL}/ticker/price`;
    const data = await fetchWithRetry(url);

    const prices = new Map<string, number>();
    for (const [symbol, pair] of Object.entries(COIN_MAP)) {
      const ticker = data.find((t: any) => t.symbol === pair);
      if (ticker) {
        prices.set(symbol, parseFloat(ticker.price));
      }
    }

    setCache(cacheKey, prices);
    return prices;
  } catch (error) {
    console.error('Erreur lors du fetch des prix:', error);
    return new Map();
  }
}

// Récupérer les klines (bougies) d'un coin
// interval: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
// limit: max 1000 bougies
export async function fetchKlines(
  coinSymbol: string, 
  interval: string, 
  limit: number = 100
): Promise<Candle[]> {
  const pair = COIN_MAP[coinSymbol];
  if (!pair) return [];

  const cacheKey = `klines-${coinSymbol}-${interval}-${limit}`;
  const cached = getCached<Candle[]>(cacheKey);
  if (cached) return cached;

  try {
    const url = `${BINANCE_BASE_URL}/klines?symbol=${pair}&interval=${interval}&limit=${limit}`;
    const data = await fetchWithRetry(url);

    // Binance retourne: [
    //   0: Open time,
    //   1: Open,
    //   2: High,
    //   3: Low,
    //   4: Close,
    //   5: Volume,
    //   ...
    // ]
    const candles: Candle[] = data.map((item: any[]) => ({
      timestamp: item[0],
      open: parseFloat(item[1]),
      high: parseFloat(item[2]),
      low: parseFloat(item[3]),
      close: parseFloat(item[4]),
      volume: parseFloat(item[5]),
    }));

    setCache(cacheKey, candles);
    return candles;
  } catch (error) {
    console.error(`Erreur lors du fetch klines pour ${coinSymbol} (${interval}):`, error);
    return [];
  }
}

// Récupérer les données complètes d'un coin (daily, 4H, 1H)
export async function fetchCoinData(coinSymbol: string): Promise<CoinData | null> {
  try {
    // Fetch en parallèle pour gagner du temps
    const [dailyCandles, h4Candles, h1Candles] = await Promise.all([
      fetchKlines(coinSymbol, '1d', 90),   // 90 jours pour le daily
      fetchKlines(coinSymbol, '4h', 180),  // 180 bougies 4H = 30 jours
      fetchKlines(coinSymbol, '1h', 168),  // 168 bougies 1H = 7 jours
    ]);

    if (dailyCandles.length === 0) return null;

    return {
      symbol: coinSymbol,
      dailyCandles,
      h4Candles,
      h1Candles,
    };
  } catch (error) {
    console.error(`Erreur lors du fetch des données pour ${coinSymbol}:`, error);
    return null;
  }
}

// Récupérer les données de tous les coins
export async function fetchAllMarketData(): Promise<Map<string, CoinData>> {
  const data = new Map<string, CoinData>();
  
  // Fetch séquentiel pour éviter de spammer l'API
  // Binance permet ~1200 requêtes/minute, mais on reste prudent
  for (const symbol of Object.keys(COIN_MAP)) {
    const coinData = await fetchCoinData(symbol);
    if (coinData) {
      data.set(symbol, coinData);
    }
    // Petit délai entre chaque coin (500ms)
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return data;
}

// Vérifier si l'API est accessible
export async function checkApiStatus(): Promise<boolean> {
  try {
    const url = `${BINANCE_BASE_URL}/ping`;
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

// Obtenir les informations sur les rate limits
export function getRateLimitInfo(): { requestsPerMinute: number; cacheDuration: number } {
  return {
    requestsPerMinute: 1200, // Binance free tier
    cacheDuration: CACHE_DURATION,
  };
}

// Récupérer les données d'un coin spécifique (utile pour refresh individuel)
export async function refreshCoinData(coinSymbol: string): Promise<CoinData | null> {
  // Invalider le cache pour ce coin
  Object.keys(COIN_MAP).forEach(key => {
    if (key === coinSymbol) {
      cache.delete(`klines-${key}-1d-90`);
      cache.delete(`klines-${key}-4h-180`);
      cache.delete(`klines-${key}-1h-168`);
    }
  });
  
  return fetchCoinData(coinSymbol);
}
