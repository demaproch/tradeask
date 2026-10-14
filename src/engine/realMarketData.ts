import { Candle, CoinData } from '../types';

// CoinGecko API configuration
const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';

// Mapping de nos symboles vers les IDs CoinGecko
const COIN_MAP: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  AVAX: 'avalanche-2',
  DOGE: 'dogecoin',
  LINK: 'chainlink',
  MATIC: 'matic-network',
  ARB: 'arbitrum',
  OP: 'optimism',
  APT: 'aptos',
  SUI: 'sui',
  INJ: 'injective-protocol',
};

// Cache pour éviter de spammer l'API
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<any>>();
const CACHE_DURATION = 60000; // 1 minute

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
        console.warn('Rate limit atteint, attente de 60 secondes...');
        await new Promise(resolve => setTimeout(resolve, 60000));
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
    const ids = Object.values(COIN_MAP).join(',');
    const url = `${COINGECKO_BASE_URL}/simple/price?ids=${ids}&vs_currencies=usd`;
    const data = await fetchWithRetry(url);

    const prices = new Map<string, number>();
    for (const [symbol, geckoId] of Object.entries(COIN_MAP)) {
      if (data[geckoId]?.usd) {
        prices.set(symbol, data[geckoId].usd);
      }
    }

    setCache(cacheKey, prices);
    return prices;
  } catch (error) {
    console.error('Erreur lors du fetch des prix:', error);
    return new Map();
  }
}

// Récupérer l'historique OHLC d'un coin
// days: 1, 7, 14, 30, 90, 180, 365
export async function fetchOHLC(coinSymbol: string, days: number = 30): Promise<Candle[]> {
  const geckoId = COIN_MAP[coinSymbol];
  if (!geckoId) return [];

  const cacheKey = `ohlc-${coinSymbol}-${days}`;
  const cached = getCached<Candle[]>(cacheKey);
  if (cached) return cached;

  try {
    const url = `${COINGECKO_BASE_URL}/coins/${geckoId}/ohlc?vs_currency=usd&days=${days}`;
    const data = await fetchWithRetry(url);

    // CoinGecko retourne: [timestamp, open, high, low, close]
    const candles: Candle[] = data.map((item: number[]) => ({
      timestamp: item[0],
      open: item[1],
      high: item[2],
      low: item[3],
      close: item[4],
      volume: 0, // CoinGecko OHLC ne fournit pas le volume
    }));

    setCache(cacheKey, candles);
    return candles;
  } catch (error) {
    console.error(`Erreur lors du fetch OHLC pour ${coinSymbol}:`, error);
    return [];
  }
}

// Récupérer les données complètes d'un coin (daily, 4H, 1H)
export async function fetchCoinData(coinSymbol: string): Promise<CoinData | null> {
  try {
    // Fetch en parallèle pour gagner du temps
    const [dailyCandles, h4Candles, h1Candles] = await Promise.all([
      fetchOHLC(coinSymbol, 90), // 90 jours pour le daily
      fetchOHLC(coinSymbol, 30), // 30 jours pour le 4H
      fetchOHLC(coinSymbol, 7),  // 7 jours pour le 1H
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
  // CoinGecko a un rate limit de ~10-30 calls/minute
  for (const symbol of Object.keys(COIN_MAP)) {
    const coinData = await fetchCoinData(symbol);
    if (coinData) {
      data.set(symbol, coinData);
    }
    // Petit délai entre chaque requête
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return data;
}

// Vérifier si l'API est accessible
export async function checkApiStatus(): Promise<boolean> {
  try {
    const url = `${COINGECKO_BASE_URL}/ping`;
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

// Obtenir les informations sur les rate limits
export function getRateLimitInfo(): { requestsPerMinute: number; cacheDuration: number } {
  return {
    requestsPerMinute: 10, // CoinGecko free tier
    cacheDuration: CACHE_DURATION,
  };
}
