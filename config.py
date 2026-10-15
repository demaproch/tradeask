"""Configuration de la stratégie Momentum RSI."""

# --- Paires tradées (format ccxt swap Binance) ---
SYMBOLS = [
    "BTC/USDT:USDT",
    "ETH/USDT:USDT",
    "SOL/USDT:USDT",
    "AVAX/USDT:USDT",
    "SUI/USDT:USDT",
]

# --- Timeframe ---
DEFAULT_TIMEFRAME = "5m"
TIMEFRAMES = ["1m", "3m", "5m", "15m", "30m", "1h", "4h"]

# --- Capital / money management ---
INITIAL_CAPITAL = 1000.0      # $ (simulé)
RISK_PCT = 0.08               # 8 % du capital risqué par trade -> marge engagée
LEVERAGE = 10                 # levier utilisé
MAX_LEVERAGE = 12             # plafond de levier

# --- Signal ---
LOOKBACK_CANDLES = 10         # variation calculée sur les 10 dernières bougies
VARIATION_THRESHOLD = 0.0055  # +/- 0,55 %
RSI_PERIOD = 6
RSI_LONG_THRESHOLD = 52       # LONG si RSI > 52
RSI_SHORT_THRESHOLD = 48      # SHORT si RSI < 48

# --- Sorties (sur le prix, exposition notionnelle) ---
TAKE_PROFIT_PCT = 0.028       # +2,8 %
STOP_LOSS_PCT = -0.01         # -1,0 %

# --- Exécution ---
POLL_INTERVAL_SEC = 50        # cycle toutes les ~50 secondes
COOLDOWN_SEC = 5 * 60         # 5 minutes entre deux trades sur le même symbole

# --- Exchange ---
EXCHANGE_ID = "binanceusdm"   # Binance Futures (testnet possible via env)
USE_TESTNET = False           # True pour utiliser le testnet futures
