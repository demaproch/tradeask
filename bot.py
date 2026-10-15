"""Moteur du bot : boucle d'exécution, signaux, ordres simulés, TP/SL, cooldown.

Fonctionne en mode PAPER TRADING par défaut (capital simulé de 1000 $).
Les prix sont réels (fetch_ohlcv via ccxt), les ordres sont simulés.
Avec LIVE=True et des clés API en variables d'environnement, il place de
vrais ordres marché sur Binance Futures.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from dataclasses import dataclass, field, asdict
from typing import Optional

import ccxt

import config
from strategy import detect_signal, position_sizing, check_exit, unrealized_pnl

log = logging.getLogger("bot")
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")

STATE_FILE = os.path.join(os.path.dirname(__file__), "state.json")
LIVE = os.environ.get("BOT_LIVE", "0") == "1"


@dataclass
class Position:
    symbol: str
    side: str                # LONG | SHORT
    entry_price: float
    quantity: float
    margin: float
    notional: float
    leverage: float
    opened_at: float         # timestamp
    tp_price: float
    sl_price: float


@dataclass
class Trade:
    symbol: str
    side: str
    entry_price: float
    exit_price: float
    quantity: float
    pnl: float              # réalisé, $
    reason: str             # TP | SL | MANUAL
    opened_at: float
    closed_at: float


class BotEngine:
    def __init__(self):
        self.lock = threading.RLock()
        self.capital = config.INITIAL_CAPITAL          # balance réalisée
        self.timeframe = config.DEFAULT_TIMEFRAME
        self.positions: dict[str, Position] = {}       # 1 max / symbole
        self.trades: list[Trade] = []
        self.last_trade_time: dict[str, float] = {}    # cooldown
        self.equity_history: list[tuple[int, float]] = []
        self.running = False
        self.thread: Optional[threading.Thread] = None
        self.exchange = self._make_exchange()
        self._load_state()

    # ------------------------------------------------------------------ exchange
    def _make_exchange(self) -> ccxt.Exchange:
        klass = getattr(ccxt, config.EXCHANGE_ID)
        params = {
            "enableRateLimit": True,
            "options": {"defaultType": "swap"},
        }
        if LIVE:
            params["apiKey"] = os.environ.get("BINANCE_API_KEY", "")
            params["secret"] = os.environ.get("BINANCE_API_SECRET", "")
            if config.USE_TESTNET:
                params["url"] = "https://testnet.binancefuture.com"
        ex = klass(params)
        if LIVE:
            try:
                ex.load_markets()
            except Exception as e:  # pragma: no cover
                log.error("load_markets: %s", e)
        return ex

    # ------------------------------------------------------------------ state I/O
    def _load_state(self):
        if not os.path.exists(STATE_FILE):
            return
        try:
            with open(STATE_FILE) as f:
                s = json.load(f)
            self.capital = s.get("capital", self.capital)
            self.timeframe = s.get("timeframe", self.timeframe)
            self.trades = [Trade(**t) for t in s.get("trades", [])]
            self.positions = {p["symbol"]: Position(**p)
                              for p in s.get("positions", [])}
            self.last_trade_time = s.get("last_trade_time", {})
            self.equity_history = [tuple(x) for x in s.get("equity_history", [])]
            log.info("État restauré : capital=%.2f, %d trades, %d positions",
                     self.capital, len(self.trades), len(self.positions))
        except Exception as e:
            log.error("Erreur chargement état: %s", e)

    def _save_state(self):
        with self.lock:
            s = {
                "capital": self.capital,
                "timeframe": self.timeframe,
                "positions": [asdict(p) for p in self.positions.values()],
                "trades": [asdict(t) for t in self.trades[-500:]],
                "last_trade_time": self.last_trade_time,
                "equity_history": self.equity_history[-5000:],
            }
            tmp = STATE_FILE + ".tmp"
            with open(tmp, "w") as f:
                json.dump(s, f)
            os.replace(tmp, STATE_FILE)

    # ------------------------------------------------------------------ data
    def fetch_candles(self, symbol: str) -> list[dict]:
        """Récupère assez de bougies pour le calcul (lookback + marge RSI)."""
        limit = config.LOOKBACK_CANDLES + config.RSI_PERIOD + 5
        raw = self.exchange.fetch_ohlcv(symbol, self.timeframe, limit=limit)
        candles = [{"timestamp": r[0], "open": r[1], "high": r[2],
                    "low": r[3], "close": r[4]} for r in raw]
        # On ignore la bougie en cours de formation : on travaille sur les
        # bougies clôturées.
        if candles:
            candles = candles[:-1]
        return candles

    def last_price(self, symbol: str) -> float:
        ticker = self.exchange.fetch_ticker(symbol)
        return float(ticker["last"])

    # ------------------------------------------------------------------ trading
    def open_position(self, symbol: str, sig) -> None:
        sizing = position_sizing(
            self.capital, sig.price,
            risk_pct=config.RISK_PCT,
            leverage=config.LEVERAGE,
            max_leverage=config.MAX_LEVERAGE,
        )
        qty = sizing["quantity"]
        lev = min(config.LEVERAGE, config.MAX_LEVERAGE)

        if LIVE:
            self.exchange.set_leverage(int(lev), symbol)
            order_side = "buy" if sig.direction == "LONG" else "sell"
            self.exchange.create_market_order(order_side, symbol, amount=qty)

        if sig.direction == "LONG":
            tp = sig.price * (1 + config.TAKE_PROFIT_PCT)
            sl = sig.price * (1 + config.STOP_LOSS_PCT)
        else:
            tp = sig.price * (1 - config.TAKE_PROFIT_PCT)
            sl = sig.price * (1 - config.STOP_LOSS_PCT)

        pos = Position(
            symbol=symbol, side=sig.direction, entry_price=sig.price,
            quantity=qty, margin=sizing["margin"], notional=sizing["notional"],
            leverage=lev, opened_at=time.time(), tp_price=tp, sl_price=sl,
        )
        with self.lock:
            self.positions[symbol] = pos
            self.last_trade_time[symbol] = time.time()
        log.info("OUVERTURE %s %s @ %.4f qty=%.6f marge=%.2f$ TP=%.4f SL=%.4f "
                 "(var=%.3f%% RSI=%.1f)", sig.direction, symbol, sig.price, qty,
                 sizing["margin"], tp, sl, sig.variation * 100, sig.rsi)

    def close_position(self, symbol: str, price: float, reason: str) -> None:
        with self.lock:
            pos = self.positions.pop(symbol, None)
        if pos is None:
            return
        if LIVE:
            order_side = "sell" if pos.side == "LONG" else "buy"
            self.exchange.create_market_order(order_side, symbol,
                                              amount=pos.quantity, params={"reduceOnly": True})
        pnl = unrealized_pnl(pos.entry_price, pos.quantity, pos.side, price)
        with self.lock:
            self.capital += pnl
            self.trades.append(Trade(
                symbol=symbol, side=pos.side, entry_price=pos.entry_price,
                exit_price=price, quantity=pos.quantity, pnl=pnl,
                reason=reason, opened_at=pos.opened_at, closed_at=time.time(),
            ))
            self.last_trade_time[symbol] = time.time()
        log.info("FERMETURE %s %s @ %.4f (%s) PnL=%+.2f$ capital=%.2f$",
                 pos.side, symbol, price, reason, pnl, self.capital)

    def manage_position(self, symbol: str) -> None:
        """TP/SL sur chaque cycle."""
        pos = self.positions.get(symbol)
        if pos is None:
            return
        price = self.last_price(symbol)
        reason = check_exit(pos.entry_price, pos.quantity, pos.side, price,
                            tp_pct=config.TAKE_PROFIT_PCT,
                            sl_pct=config.STOP_LOSS_PCT)
        if reason:
            self.close_position(symbol, price, reason)

    def try_entry(self, symbol: str) -> None:
        if symbol in self.positions:
            return  # une seule position par symbole
        last = self.last_trade_time.get(symbol, 0)
        if time.time() - last < config.COOLDOWN_SEC:
            return  # cooldown
        candles = self.fetch_candles(symbol)
        sig = detect_signal(
            symbol, candles,
            lookback=config.LOOKBACK_CANDLES,
            variation_threshold=config.VARIATION_THRESHOLD,
            rsi_period=config.RSI_PERIOD,
            rsi_long=config.RSI_LONG_THRESHOLD,
            rsi_short=config.RSI_SHORT_THRESHOLD,
        )
        if sig:
            self.open_position(symbol, sig)

    # ------------------------------------------------------------------ loop
    def equity(self) -> float:
        """Capital + PnL non réalisé."""
        total = self.capital
        for pos in list(self.positions.values()):
            try:
                price = self.last_price(pos.symbol)
                total += unrealized_pnl(pos.entry_price, pos.quantity,
                                        pos.side, price)
            except Exception:
                pass
        return total

    def cycle(self):
        for symbol in config.SYMBOLS:
            try:
                self.manage_position(symbol)   # sortie prioritaire
                self.try_entry(symbol)         # puis entrée éventuelle
            except ccxt.NetworkError as e:
                log.warning("Réseau %s: %s", symbol, e)
            except Exception as e:
                log.error("Erreur cycle %s: %s", symbol, e)
        eq = self.equity()
        with self.lock:
            self.equity_history.append((int(time.time()), round(eq, 2)))
        self._save_state()
        log.info("Equity: %.2f$ | Positions: %d | Trades: %d",
                 eq, len(self.positions), len(self.trades))

    def run_loop(self):
        self.running = True
        while self.running:
            start = time.time()
            self.cycle()
            sleep = max(1.0, config.POLL_INTERVAL_SEC - (time.time() - start))
            # sleep interruptible
            end = time.time() + sleep
            while self.running and time.time() < end:
                time.sleep(0.5)

    def start(self):
        if self.thread and self.thread.is_alive():
            return
        self.thread = threading.Thread(target=self.run_loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False

    # ------------------------------------------------------------------ api dashboard
    def set_timeframe(self, tf: str):
        if tf in config.TIMEFRAMES:
            with self.lock:
                self.timeframe = tf
            self._save_state()
            log.info("Timeframe changé -> %s", tf)

    def close_all(self):
        for symbol in list(self.positions.keys()):
            try:
                self.close_position(symbol, self.last_price(symbol), "MANUAL")
            except Exception as e:
                log.error("close_all %s: %s", symbol, e)


# Instance globale partagée avec le dashboard
engine = BotEngine()
