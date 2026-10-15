"""Tests unitaires de la logique stratégie (offline)."""
import numpy as np
from strategy import compute_rsi, detect_signal, position_sizing, check_exit, unrealized_pnl


def candles_from_closes(closes):
    return [{"timestamp": i, "open": c, "high": c, "low": c, "close": c}
            for i, c in enumerate(closes)]


def test_rsi_all_gains():
    closes = np.arange(1, 20, dtype=float)
    assert abs(compute_rsi(closes, 6) - 100.0) < 1e-9


def test_rsi_all_losses():
    closes = np.arange(20, 1, -1, dtype=float)
    assert compute_rsi(closes, 6) < 1e-9


def test_long_signal():
    # baisse puis forte hausse sur les 10 dernières bougies
    closes = [100.0] * 8 + list(np.linspace(100, 101.2, 10))  # +1.2 % > 0.55 %
    sig = detect_signal("BTC/USDT:USDT", candles_from_closes(closes))
    assert sig is not None and sig.direction == "LONG"
    assert sig.variation > 0.0055 and sig.rsi > 52


def test_short_signal():
    closes = [100.0] * 8 + list(np.linspace(100, 98.8, 10))  # -1.2 %
    sig = detect_signal("ETH/USDT:USDT", candles_from_closes(closes))
    assert sig is not None and sig.direction == "SHORT"
    assert sig.variation < -0.0055 and sig.rsi < 48


def test_no_signal_small_move():
    closes = [100.0] * 8 + list(np.linspace(100, 100.2, 10))  # +0.2 % < seuil
    assert detect_signal("SOL/USDT:USDT", candles_from_closes(closes)) is None


def test_sizing():
    s = position_sizing(1000, 50000, risk_pct=0.08, leverage=10, max_leverage=12)
    assert abs(s["margin"] - 80) < 1e-9
    assert abs(s["notional"] - 800) < 1e-9
    assert abs(s["quantity"] - 800 / 50000) < 1e-12


def test_tp_sl_long():
    assert check_exit(100, 1, "LONG", 102.9) == "TP"     # +2.9 % >= 2.8
    assert check_exit(100, 1, "LONG", 98.9) == "SL"      # -1.1 % <= -1
    assert check_exit(100, 1, "LONG", 101.0) is None


def test_tp_sl_short():
    assert check_exit(100, 1, "SHORT", 97.0) == "TP"     # short gagne si -3 %
    assert check_exit(100, 1, "SHORT", 101.5) == "SL"
    assert check_exit(100, 1, "SHORT", 99.5) is None


def test_upnl():
    assert abs(unrealized_pnl(100, 2, "LONG", 105) - 10) < 1e-9
    assert abs(unrealized_pnl(100, 2, "SHORT", 105) + 10) < 1e-9


if __name__ == "__main__":
    import test_strategy as m
    fns = [getattr(m, n) for n in dir(m) if n.startswith("test_")]
    for fn in fns:
        fn()
        print(f"OK {fn.__name__}")
    print(f"{len(fns)} tests passés")
