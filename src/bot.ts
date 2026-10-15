/** Moteur du bot : boucle d'exécution, signaux, ordres simulés, TP/SL, cooldown.
 *
 * Fonctionne en mode PAPER TRADING par défaut (capital simulé de 1000 $).
 * Les prix sont réels (fetchOHLCV via ccxt), les ordres sont simulés.
 * Avec BOT_LIVE=1 et des clés API en variables d'environnement, il place de
 * vrais ordres marché sur Binance Futures.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ccxt from "ccxt";
import type { binanceusdm as BinanceUsdm, Dict, OHLCV } from "ccxt";

import * as config from "./config.js";
import {
  type Candle,
  type Direction,
  type ExitReason,
  type Signal,
  detectSignal,
  positionSizing,
  checkExit,
  unrealizedPnl,
} from "./strategy.js";

const log = console;

const STATE_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "state.json",
);
const LIVE = process.env.BOT_LIVE === "1";

export interface Position {
  symbol: string;
  side: Direction; // LONG | SHORT
  entry_price: number;
  quantity: number;
  margin: number;
  notional: number;
  leverage: number;
  opened_at: number; // timestamp (secondes)
  tp_price: number;
  sl_price: number;
}

export interface Trade {
  symbol: string;
  side: Direction;
  entry_price: number;
  exit_price: number;
  quantity: number;
  pnl: number; // réalisé, $
  reason: ExitReason; // TP | SL | MANUAL
  opened_at: number;
  closed_at: number;
}

interface StateFile {
  capital?: number;
  timeframe?: string;
  positions?: Position[];
  trades?: Trade[];
  last_trade_time?: Record<string, number>;
  equity_history?: [number, number][];
}

type Exchange = BinanceUsdm;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BotEngine {
  capital: number = config.INITIAL_CAPITAL; // balance réalisée
  timeframe: string = config.DEFAULT_TIMEFRAME;
  positions: Map<string, Position> = new Map(); // 1 max / symbole
  trades: Trade[] = [];
  lastTradeTime: Map<string, number> = new Map(); // cooldown
  equityHistory: [number, number][] = [];
  running = false;
  private loopPromise: Promise<void> | null = null;
  readonly exchange: Exchange;

  constructor() {
    this.exchange = this.makeExchange();
    this.loadState();
  }

  // ------------------------------------------------------------------ exchange
  private makeExchange(): Exchange {
    const params: Dict = {
      enableRateLimit: true,
      options: { defaultType: "swap" },
    };
    if (LIVE) {
      params.apiKey = process.env.BINANCE_API_KEY ?? "";
      params.secret = process.env.BINANCE_API_SECRET ?? "";
      if (config.USE_TESTNET) {
        params.url = "https://testnet.binancefuture.com";
      }
    }
    const ex = new ccxt.binanceusdm(params);
    if (LIVE) {
      ex.load_markets().catch((e: unknown) => log.error("load_markets:", e));
    }
    return ex;
  }

  // ------------------------------------------------------------------ state I/O
  private loadState(): void {
    if (!fs.existsSync(STATE_FILE)) return;
    try {
      const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as StateFile;
      this.capital = s.capital ?? this.capital;
      this.timeframe = s.timeframe ?? this.timeframe;
      this.trades = s.trades ?? [];
      this.positions = new Map((s.positions ?? []).map((p) => [p.symbol, p]));
      this.lastTradeTime = new Map(Object.entries(s.last_trade_time ?? {}));
      this.equityHistory = s.equity_history ?? [];
      log.info?.(
        `État restauré : capital=${this.capital.toFixed(2)}, ` +
          `${this.trades.length} trades, ${this.positions.size} positions`,
      );
    } catch (e) {
      log.error("Erreur chargement état:", e);
    }
  }

  private saveState(): void {
    const s: StateFile = {
      capital: this.capital,
      timeframe: this.timeframe,
      positions: [...this.positions.values()],
      trades: this.trades.slice(-500),
      last_trade_time: Object.fromEntries(this.lastTradeTime),
      equity_history: this.equityHistory.slice(-5000),
    };
    const tmp = STATE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(s));
    fs.renameSync(tmp, STATE_FILE);
  }

  // ------------------------------------------------------------------ data
  /** Récupère assez de bougies pour le calcul (lookback + marge RSI). */
  async fetchCandles(symbol: string): Promise<Candle[]> {
    const limit = config.LOOKBACK_CANDLES + config.RSI_PERIOD + 5;
    const raw = await this.exchange.fetchOHLCV(symbol, this.timeframe, undefined, limit);
    const candles: Candle[] = raw.map((r) => ({
      timestamp: r[0] as number,
      open: r[1] as number,
      high: r[2] as number,
      low: r[3] as number,
      close: r[4] as number,
    }));
    // On ignore la bougie en cours de formation : on travaille sur les
    // bougies clôturées.
    if (candles.length > 0) candles.pop();
    return candles;
  }

  async lastPrice(symbol: string): Promise<number> {
    const ticker = await this.exchange.fetchTicker(symbol);
    return Number(ticker.last);
  }

  // ------------------------------------------------------------------ trading
  async openPosition(symbol: string, sig: Signal): Promise<void> {
    const sizing = positionSizing(this.capital, sig.price, {
      riskPct: config.RISK_PCT,
      leverage: config.LEVERAGE,
      maxLeverage: config.MAX_LEVERAGE,
    });
    const qty = sizing.quantity;
    const lev = Math.min(config.LEVERAGE, config.MAX_LEVERAGE);

    if (LIVE) {
      await this.exchange.setLeverage(Math.trunc(lev), symbol);
      const orderSide = sig.direction === "LONG" ? "buy" : "sell";
      await this.exchange.createOrder(symbol, "market", orderSide, qty);
    }

    let tp: number, sl: number;
    if (sig.direction === "LONG") {
      tp = sig.price * (1 + config.TAKE_PROFIT_PCT);
      sl = sig.price * (1 + config.STOP_LOSS_PCT);
    } else {
      tp = sig.price * (1 - config.TAKE_PROFIT_PCT);
      sl = sig.price * (1 - config.STOP_LOSS_PCT);
    }

    const pos: Position = {
      symbol,
      side: sig.direction,
      entry_price: sig.price,
      quantity: qty,
      margin: sizing.margin,
      notional: sizing.notional,
      leverage: lev,
      opened_at: Date.now() / 1000,
      tp_price: tp,
      sl_price: sl,
    };
    this.positions.set(symbol, pos);
    this.lastTradeTime.set(symbol, Date.now() / 1000);
    log.info(
      `OUVERTURE ${sig.direction} ${symbol} @ ${sig.price.toFixed(4)} ` +
        `qty=${qty.toFixed(6)} marge=${sizing.margin.toFixed(2)}$ ` +
        `TP=${tp.toFixed(4)} SL=${sl.toFixed(4)} ` +
        `(var=${(sig.variation * 100).toFixed(3)}% RSI=${sig.rsi.toFixed(1)})`,
    );
  }

  async closePosition(symbol: string, price: number, reason: ExitReason): Promise<void> {
    const pos = this.positions.get(symbol);
    if (!pos) return;
    this.positions.delete(symbol);
    if (LIVE) {
      const orderSide = pos.side === "LONG" ? "sell" : "buy";
      await this.exchange.createOrder(
        symbol,
        "market",
        orderSide,
        pos.quantity,
        undefined,
        { reduceOnly: true },
      );
    }
    const pnl = unrealizedPnl(pos.entry_price, pos.quantity, pos.side, price);
    this.capital += pnl;
    this.trades.push({
      symbol,
      side: pos.side,
      entry_price: pos.entry_price,
      exit_price: price,
      quantity: pos.quantity,
      pnl,
      reason,
      opened_at: pos.opened_at,
      closed_at: Date.now() / 1000,
    });
    this.lastTradeTime.set(symbol, Date.now() / 1000);
    log.info(
      `FERMETURE ${pos.side} ${symbol} @ ${price.toFixed(4)} (${reason}) ` +
        `PnL=${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}$ capital=${this.capital.toFixed(2)}$`,
    );
  }

  /** TP/SL sur chaque cycle. */
  async managePosition(symbol: string): Promise<void> {
    const pos = this.positions.get(symbol);
    if (!pos) return;
    const price = await this.lastPrice(symbol);
    const reason = checkExit(pos.entry_price, pos.quantity, pos.side, price, {
      tpPct: config.TAKE_PROFIT_PCT,
      slPct: config.STOP_LOSS_PCT,
    });
    if (reason) await this.closePosition(symbol, price, reason);
  }

  async tryEntry(symbol: string): Promise<void> {
    if (this.positions.has(symbol)) return; // une seule position par symbole
    const last = this.lastTradeTime.get(symbol) ?? 0;
    if (Date.now() / 1000 - last < config.COOLDOWN_SEC) return; // cooldown
    const candles = await this.fetchCandles(symbol);
    const sig = detectSignal(symbol, candles, {
      lookback: config.LOOKBACK_CANDLES,
      variationThreshold: config.VARIATION_THRESHOLD,
      rsiPeriod: config.RSI_PERIOD,
      rsiLong: config.RSI_LONG_THRESHOLD,
      rsiShort: config.RSI_SHORT_THRESHOLD,
    });
    if (sig) await this.openPosition(symbol, sig);
  }

  // ------------------------------------------------------------------ loop
  /** Capital + PnL non réalisé. */
  async equity(): Promise<number> {
    let total = this.capital;
    for (const pos of [...this.positions.values()]) {
      try {
        const price = await this.lastPrice(pos.symbol);
        total += unrealizedPnl(pos.entry_price, pos.quantity, pos.side, price);
      } catch {
        /* best effort */
      }
    }
    return total;
  }

  async cycle(): Promise<void> {
    for (const symbol of config.SYMBOLS) {
      try {
        await this.managePosition(symbol); // sortie prioritaire
        await this.tryEntry(symbol); // puis entrée éventuelle
      } catch (e) {
        if (e instanceof ccxt.NetworkError) {
          log.warn(`Réseau ${symbol}:`, e.message);
        } else {
          log.error(`Erreur cycle ${symbol}:`, e);
        }
      }
    }
    const eq = await this.equity();
    this.equityHistory.push([Math.trunc(Date.now() / 1000), Math.round(eq * 100) / 100]);
    this.saveState();
    log.info(
      `Equity: ${eq.toFixed(2)}$ | Positions: ${this.positions.size} | Trades: ${this.trades.length}`,
    );
  }

  async runLoop(): Promise<void> {
    this.running = true;
    while (this.running) {
      const start = Date.now() / 1000;
      await this.cycle();
      const nap = Math.max(1.0, config.POLL_INTERVAL_SEC - (Date.now() / 1000 - start));
      // sleep interruptible
      const end = Date.now() / 1000 + nap;
      while (this.running && Date.now() / 1000 < end) {
        await sleep(500);
      }
    }
  }

  start(): void {
    if (this.running && this.loopPromise) return;
    this.loopPromise = this.runLoop();
  }

  stop(): void {
    this.running = false;
  }

  // ------------------------------------------------------------------ api dashboard
  setTimeframe(tf: string): void {
    if ((config.TIMEFRAMES as readonly string[]).includes(tf)) {
      this.timeframe = tf;
      this.saveState();
      log.info(`Timeframe changé -> ${tf}`);
    }
  }

  async closeAll(): Promise<void> {
    for (const symbol of [...this.positions.keys()]) {
      try {
        await this.closePosition(symbol, await this.lastPrice(symbol), "MANUAL");
      } catch (e) {
        log.error(`close_all ${symbol}:`, e);
      }
    }
  }
}

// Instance globale partagée avec le dashboard
export const engine = new BotEngine();
