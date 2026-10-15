"""Logique pure de la stratégie : RSI, détection de signal, money management.

Aucune dépendance à ccxt ici -> testable unitairement.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np


def compute_rsi(closes: np.ndarray, period: int = 6) -> float:
    """RSI classique (moyennes mobiles simples des gains/pertes).

    `closes` doit contenir au moins period + 1 valeurs.
    Retourne le RSI sur la dernière bougie (0-100).
    """
    closes = np.asarray(closes, dtype=float)
    if len(closes) < period + 1:
        return 50.0
    deltas = np.diff(closes)
    gains = np.clip(deltas, 0.0, None)
    losses = np.clip(-deltas, 0.0, None)
    avg_gain = gains[-period:].mean()
    avg_loss = losses[-period:].mean()
    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else 50.0
    rs = avg_gain / avg_loss
    return float(100.0 - 100.0 / (1.0 + rs))


@dataclass
class Signal:
    symbol: str
    direction: str          # "LONG" | "SHORT"
    variation: float        # ex: 0.0072 pour +0,72 %
    rsi: float
    price: float            # prix d'entrée (dernier close)


def detect_signal(
    symbol: str,
    candles: list[dict],
    *,
    lookback: int = 10,
    variation_threshold: float = 0.0055,
    rsi_period: int = 6,
    rsi_long: float = 52.0,
    rsi_short: float = 48.0,
) -> Optional[Signal]:
    """Détecte un signal momentum sur les `lookback` dernières bougies.

    candles : liste de dicts {timestamp, open, high, low, close}, triée du plus
    ancien au plus récent. On utilise les N dernières bougies clôturées :
      variation = (close[-1] - close[-1-lookback]) / close[-1-lookback]
    LONG  si variation > +seuil ET RSI > rsi_long
    SHORT si variation < -seuil ET RSI < rsi_short
    """
    closes = np.array([c["close"] for c in candles], dtype=float)
    if len(closes) < lookback + 1:
        return None

    current = closes[-1]
    past = closes[-1 - lookback]
    if past <= 0:
        return None
    variation = (current - past) / past
    rsi = compute_rsi(closes, rsi_period)

    if variation > variation_threshold and rsi > rsi_long:
        return Signal(symbol, "LONG", variation, rsi, float(current))
    if variation < -variation_threshold and rsi < rsi_short:
        return Signal(symbol, "SHORT", variation, rsi, float(current))
    return None


def position_sizing(
    capital: float,
    entry_price: float,
    *,
    risk_pct: float = 0.08,
    leverage: float = 10.0,
    max_leverage: float = 12.0,
) -> dict:
    """Marge = risk_pct x capital ; notionnel = marge x levier.

    Retourne {margin, notional, quantity}.
    """
    leverage = min(leverage, max_leverage)
    margin = capital * risk_pct
    notional = margin * leverage
    quantity = notional / entry_price if entry_price > 0 else 0.0
    return {"margin": margin, "notional": notional, "quantity": quantity}


def check_exit(entry_price: float, quantity: float, side: str, current_price: float,
                *, tp_pct: float = 0.028, sl_pct: float = -0.01) -> Optional[str]:
    """Vérifie TP/SL fixes sur la variation de prix (côté position).

    Retourne "TP", "SL" ou None.
    """
    if entry_price <= 0:
        return None
    change = (current_price - entry_price) / entry_price
    if side == "SHORT":
        change = -change
    if change >= tp_pct:
        return "TP"
    if change <= sl_pct:
        return "SL"
    return None


def unrealized_pnl(entry_price: float, quantity: float, side: str,
                   current_price: float) -> float:
    """PnL non réalisé en $ (USDT) sur la position."""
    sign = 1.0 if side == "LONG" else -1.0
    return sign * (current_price - entry_price) * quantity
