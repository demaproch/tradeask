import { useState, useEffect, useCallback, useRef } from 'react';
import {
  DeskState, BotStatus, WatchlistEntry, FairValueGap, TradePlan,
  GateAlert, Position, TradeRecord, AuditReport, LogEntry, DeskRules, CoinData
} from './types';
import {
  DEFAULT_RULES, runScreener, runCartographer, runRiskOfficer,
  runExitClerk, runAuditor, calculateResultInR
} from './engine/tradingEngine';
import { generateMarketData, getCurrentPrices } from './engine/marketSimulator';
import { fetchAllMarketData, fetchCurrentPrices, checkApiStatus } from './engine/realMarketData';

// ============ MAIN APP ============
export default function App() {
  const [deskState, setDeskState] = useState<DeskState | null>(null);
  const [rules] = useState<DeskRules>(DEFAULT_RULES);
  const [marketData, setMarketData] = useState<Map<string, CoinData>>(new Map());
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [accountBalance] = useState(10000);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Mode de données : simulation ou live
  const [dataMode, setDataMode] = useState<'simulation' | 'live'>('simulation');
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [apiStatus, setApiStatus] = useState<'unknown' | 'online' | 'offline'>('unknown');
  
  // Refs pour éviter les problèmes de closure dans setInterval
  const runningRef = useRef(false);
  const marketDataRef = useRef(marketData);
  const rulesRef = useRef(rules);
  const dataModeRef = useRef(dataMode);
  
  // Mettre à jour les refs quand les états changent
  useEffect(() => {
    marketDataRef.current = marketData;
  }, [marketData]);
  
  useEffect(() => {
    rulesRef.current = rules;
  }, [rules]);
  
  useEffect(() => {
    dataModeRef.current = dataMode;
  }, [dataMode]);
  
  // Vérifier le statut de l'API au démarrage
  useEffect(() => {
    checkApiStatus().then(status => {
      setApiStatus(status ? 'online' : 'offline');
    });
  }, []);

  // Charger les données de marché selon le mode
  const loadMarketData = useCallback(async (mode: 'simulation' | 'live') => {
    setLoading(true);
    try {
      let data: Map<string, CoinData>;
      
      if (mode === 'live') {
        console.log('📡 Chargement des données réelles depuis Binance...');
        data = await fetchAllMarketData();
        console.log(`✅ ${data.size} coins chargés`);
      } else {
        console.log('🎲 Génération de données simulées...');
        data = generateMarketData();
        console.log(`✅ ${data.size} coins simulés`);
      }
      
      setMarketData(data);
      marketDataRef.current = data; // Mettre à jour le ref immédiatement
      setLastUpdate(Date.now());
      return data;
    } catch (error) {
      console.error('❌ Erreur lors du chargement des données:', error);
      // Fallback sur la simulation en cas d'erreur
      const fallbackData = generateMarketData();
      setMarketData(fallbackData);
      marketDataRef.current = fallbackData; // Mettre à jour le ref immédiatement
      setLastUpdate(Date.now());
      return fallbackData;
    } finally {
      setLoading(false);
    }
  }, []);

  const initDesk = useCallback(async () => {
    const data = await loadMarketData(dataMode);

    const initialBots: BotStatus[] = [
      { name: 'Screener', role: 'Finds the turn', lastRun: null, status: 'IDLE', output: '0 coins', alerts: 0 },
      { name: 'Cartographer', role: 'Maps the zone', lastRun: null, status: 'IDLE', output: '0 zones', alerts: 0 },
      { name: 'Risk Officer', role: 'Sizes positions', lastRun: null, status: 'IDLE', output: '0 plans', alerts: 0 },
      { name: 'Gate', role: 'Pings, you press', lastRun: null, status: 'IDLE', output: '0 alerts', alerts: 0 },
      { name: 'Exit Clerk', role: 'Closes without negotiating', lastRun: null, status: 'IDLE', output: '0 positions', alerts: 0 },
      { name: 'Auditor', role: 'Grades the desk', lastRun: null, status: 'IDLE', output: '0 trades', alerts: 0 },
    ];

    setDeskState({
      accountBalance,
      riskPerTrade: rules.riskPerTrade,
      addRisk: rules.addRisk,
      watchlist: [],
      zoneMaps: new Map(),
      tradePlans: [],
      alerts: [],
      positions: [],
      trades: [],
      botStatuses: initialBots,
      auditReport: null,
      running: false,
      logs: [],
    });
  }, [accountBalance, rules, dataMode, loadMarketData]);

  // Changer le mode de données
  const switchDataMode = async (mode: 'simulation' | 'live') => {
    setDataMode(mode);
    dataModeRef.current = mode;
    
    // Arrêter le desk temporairement
    if (deskState?.running) {
      runningRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    
    // Charger les nouvelles données
    await loadMarketData(mode);
    
    // Redémarrer le desk si il était actif
    if (deskState?.running) {
      runningRef.current = true;
      setTimeout(() => {
        runDeskCycle();
        simulateExits();
      }, 100);
      intervalRef.current = setInterval(() => {
        runDeskCycle();
        simulateExits();
      }, 3000);
    }
  };

  // Mettre à jour les données de marché (pour le mode live)
  const refreshMarketData = async () => {
    if (dataModeRef.current === 'live') {
      await loadMarketData('live');
    }
  };

  // Charger l'état sauvegardé ou initialiser
  useEffect(() => {
    const savedState = localStorage.getItem('grokDeskState');
    if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
        // Restaurer l'état avec running = true si c'était le cas
        setDeskState({
          ...parsed,
          zoneMaps: new Map(Object.entries(parsed.zoneMaps || {})),
          running: parsed.running || false,
        });
      } catch (e) {
        console.error('Failed to load saved state:', e);
        initDesk();
      }
    } else {
      initDesk();
    }
  }, [initDesk]);
  
  // Sauvegarder l'état à chaque changement (sans les données de marché)
  useEffect(() => {
    if (deskState) {
      const toSave = {
        ...deskState,
        zoneMaps: Object.fromEntries(deskState.zoneMaps),
        // Ne pas sauvegarder les données de marché (trop volumineuses)
        // Elles seront rechargées au démarrage
      };
      try {
        localStorage.setItem('grokDeskState', JSON.stringify(toSave));
      } catch (e) {
        console.warn('Impossible de sauvegarder l\'état (quota dépassé?)', e);
      }
    }
  }, [deskState]);

  // Run the full desk cycle
  const runDeskCycle = useCallback(() => {
    if (!runningRef.current) return;
    const currentMarketData = marketDataRef.current;
    const currentRules = rulesRef.current;
    if (currentMarketData.size === 0) return;

    setDeskState(prev => {
      if (!prev || !prev.running) return prev;
      const now = Date.now();
      const allLogs: LogEntry[] = [];
      let newBots = [...prev.botStatuses];

      // 1. SCREENER
      newBots[0] = { ...newBots[0], status: 'RUNNING', lastRun: now };
      const coinArray = Array.from(currentMarketData.entries()).map(([symbol, data]) => ({
        symbol,
        dailyCandles: data.dailyCandles,
        h4Candles: data.h4Candles,
      }));
      const screenerResult = runScreener(coinArray, currentRules);
      const newWatchlist = [...prev.watchlist];
      for (const entry of screenerResult.watchlist) {
        if (!newWatchlist.find(w => w.coin === entry.coin)) {
          newWatchlist.push(entry);
        }
      }
      allLogs.push(...screenerResult.logs);
      newBots[0] = {
        ...newBots[0],
        status: 'IDLE',
        output: `${newWatchlist.length} coins on watchlist`,
        alerts: screenerResult.watchlist.length,
      };

      // 2. CARTOGRAPHER
      newBots[1] = { ...newBots[1], status: 'RUNNING', lastRun: now };
      const h4Data = new Map<string, import('./types').Candle[]>();
      const h1Data = new Map<string, import('./types').Candle[]>();
      for (const [coin, data] of currentMarketData) {
        h4Data.set(coin, data.h4Candles);
        h1Data.set(coin, data.h1Candles);
      }
      const currentPrices = getCurrentPrices(currentMarketData);
      const cartographerResult = runCartographer(newWatchlist, h4Data, h1Data, currentPrices);
      allLogs.push(...cartographerResult.logs);
      let totalZones = 0;
      for (const [, zm] of cartographerResult.zoneMaps) {
        totalZones += zm.zones.length;
      }
      newBots[1] = {
        ...newBots[1],
        status: 'IDLE',
        output: `${totalZones} zones mapped`,
        alerts: cartographerResult.logs.filter(l => l.level === 'SUCCESS').length,
      };

      // 3. RISK OFFICER
      newBots[2] = { ...newBots[2], status: 'RUNNING', lastRun: now };
      const riskResult = runRiskOfficer(cartographerResult.zoneMaps, prev.accountBalance, currentRules, prev.positions);
      allLogs.push(...riskResult.logs);
      const newPlans = [...prev.tradePlans];
      for (const plan of riskResult.tradePlans) {
        if (!newPlans.find(p => p.coin === plan.coin && p.addNumber === plan.addNumber)) {
          newPlans.push(plan);
        }
      }
      newBots[2] = {
        ...newBots[2],
        status: 'IDLE',
        output: `${riskResult.tradePlans.filter(p => p.status === 'APPROVED').length} plans ready`,
        alerts: riskResult.tradePlans.filter(p => p.status === 'APPROVED').length,
      };

      // 4. GATE — create alerts for approved plans
      newBots[3] = { ...newBots[3], status: 'RUNNING', lastRun: now };
      const newAlerts = [...prev.alerts];
      for (const plan of riskResult.tradePlans) {
        if (plan.status === 'APPROVED' && !newAlerts.find(a => a.tradePlan.id === plan.id)) {
          newAlerts.push({
            id: `alert-${plan.id}`,
            tradePlan: plan,
            decision: 'PENDING',
            sentAt: now,
          });
        }
      }
      newBots[3] = {
        ...newBots[3],
        status: 'WAITING',
        output: `${newAlerts.filter(a => a.decision === 'PENDING').length} awaiting your tap`,
        alerts: newAlerts.filter(a => a.decision === 'PENDING').length,
      };

      // 5. EXIT CLERK
      newBots[4] = { ...newBots[4], status: 'RUNNING', lastRun: now };
      const dailyCloses = new Map<string, number>();
      const anchorHighs = new Map<string, number>();
      const marketStates = new Map<string, string>();
      for (const [coin, data] of currentMarketData) {
        const lastDaily = data.dailyCandles[data.dailyCandles.length - 1];
        dailyCloses.set(coin, lastDaily.close);
        const wl = newWatchlist.find(w => w.coin === coin);
        if (wl) anchorHighs.set(coin, wl.anchorHigh);
        marketStates.set(coin, 'BEARISH');
      }
      const exitResult = runExitClerk(prev.positions, currentPrices, dailyCloses, anchorHighs, currentRules, marketStates);
      allLogs.push(...exitResult.logs);
      newBots[4] = {
        ...newBots[4],
        status: 'IDLE',
        output: `${prev.positions.filter(p => p.status === 'OPEN').length} positions monitored`,
        alerts: exitResult.exits.length + exitResult.staleFlags.length,
      };

      // 6. AUDITOR
      newBots[5] = { ...newBots[5], status: 'RUNNING', lastRun: now };
      const auditReport = prev.trades.length > 0 ? runAuditor(prev.trades, currentRules) : null;
      newBots[5] = {
        ...newBots[5],
        status: 'IDLE',
        output: `${prev.trades.length} trades logged`,
        alerts: 0,
      };

      // Merge zone maps
      const mergedZones = new Map(prev.zoneMaps);
      for (const [coin, zm] of cartographerResult.zoneMaps) {
        mergedZones.set(coin, zm);
      }

      return {
        ...prev,
        watchlist: newWatchlist,
        zoneMaps: mergedZones,
        tradePlans: newPlans,
        alerts: newAlerts,
        botStatuses: newBots,
        auditReport,
        logs: [...allLogs, ...prev.logs].slice(0, 200),
      };
    });
  }, []); // Pas de dépendances : on utilise les refs

  // Handle gate decision
  const handleGateDecision = (alertId: string, decision: 'TAKEN' | 'SKIPPED') => {
    setDeskState(prev => {
      if (!prev) return prev;
      const now = Date.now();
      const alerts = prev.alerts.map(a =>
        a.id === alertId ? { ...a, decision, decidedAt: now } : a
      );

      let positions = [...prev.positions];
      let trades = [...prev.trades];

      if (decision === 'TAKEN') {
        const alert = prev.alerts.find(a => a.id === alertId);
        if (alert) {
          const plan = alert.tradePlan;
          const newPos: Position = {
            id: `pos-${plan.id}`,
            coin: plan.coin,
            entry: plan.entry,
            stop: plan.stop,
            size: plan.size,
            riskPct: plan.riskPct,
            openedAt: now,
            addNumber: plan.addNumber,
            breakeven: false,
            currentPnl: 0,
            currentPnlR: 0,
            status: 'OPEN',
          };
          positions.push(newPos);
        }
      } else {
        // Log skipped trade for auditor
        const alert = prev.alerts.find(a => a.id === alertId);
        if (alert) {
          const plan = alert.tradePlan;
          const skippedTrade: TradeRecord = {
            id: `skipped-${plan.id}`,
            coin: plan.coin,
            entry: plan.entry,
            exit: plan.entry, // would have exited at same (simulated)
            size: plan.size,
            fee: 0,
            slippage: 0,
            resultR: Math.random() > 0.5 ? Math.random() * 3 : -(Math.random() * 1.5),
            pnl: 0,
            openedAt: now,
            closedAt: now,
            exitReason: 'SKIPPED',
            wasSkipped: true,
          };
          trades.push(skippedTrade);
        }
      }

      return { ...prev, alerts, positions, trades };
    });
  };

  // Close a position manually (simulate exit)
  const closePosition = (posId: string, reason: string) => {
    setDeskState(prev => {
      if (!prev) return prev;
      const now = Date.now();
      const currentPrices = getCurrentPrices(marketData);

      const positions = prev.positions.map(p => {
        if (p.id === posId && p.status === 'OPEN') {
          const exitPrice = currentPrices.get(p.coin) || p.entry;
          const pnl = (p.entry - exitPrice) * (p.size / p.entry);
          const resultR = calculateResultInR(p.entry, exitPrice, p.stop, true);
          const fee = p.size * 0.0004; // 0.04% fee

          const trade: TradeRecord = {
            id: `trade-${p.id}`,
            coin: p.coin,
            entry: p.entry,
            exit: exitPrice,
            size: p.size,
            fee,
            slippage: Math.abs(exitPrice - p.entry) * 0.001,
            resultR,
            pnl: pnl - fee,
            openedAt: p.openedAt,
            closedAt: now,
            exitReason: reason,
            wasSkipped: false,
          };

          return { ...p, status: 'CLOSED' as const, closedAt: now, exitPrice, exitReason: reason, currentPnl: pnl };
        }
        return p;
      });

      // Extract closed trades
      const newlyClosed = positions.filter(p => p.status === 'CLOSED' && !prev.trades.find(t => t.id === `trade-${p.id}`));
      const newTrades: TradeRecord[] = newlyClosed.map(p => ({
        id: `trade-${p.id}`,
        coin: p.coin,
        entry: p.entry,
        exit: p.exitPrice || p.entry,
        size: p.size,
        fee: p.size * 0.0004,
        slippage: 0,
        resultR: calculateResultInR(p.entry, p.exitPrice || p.entry, p.stop, true),
        pnl: ((p.entry - (p.exitPrice || p.entry)) * (p.size / p.entry)) - p.size * 0.0004,
        openedAt: p.openedAt,
        closedAt: now,
        exitReason: reason,
        wasSkipped: false,
      }));

      const updatedTrades = [...prev.trades, ...newTrades];
      const auditReport = updatedTrades.length > 0 ? runAuditor(updatedTrades, rules) : null;

      return { ...prev, positions, trades: updatedTrades, auditReport };
    });
  };

  // Auto-close positions for simulation
  const simulateExits = useCallback(() => {
    if (!runningRef.current) return;
    const currentMarketData = marketDataRef.current;
    const currentRules = rulesRef.current;
    if (currentMarketData.size === 0) return;
    
    setDeskState(prev => {
      if (!prev || !prev.running) return prev;
      const currentPrices = getCurrentPrices(currentMarketData);
      const now = Date.now();

      const positions = prev.positions.map(p => {
        if (p.status !== 'OPEN') return p;
        const price = currentPrices.get(p.coin) || p.entry;
        const pnl = (p.entry - price) * (p.size / p.entry);
        const pnlR = calculateResultInR(p.entry, price, p.stop, true);
        const breakeven = pnl > 0;

        // Auto-close if stop hit
        if (price >= p.stop) {
          return { ...p, status: 'CLOSED' as const, closedAt: now, exitPrice: p.stop, exitReason: 'STOP HIT', currentPnl: pnl, currentPnlR: pnlR, breakeven };
        }
        // Auto-close if TP (2R)
        if (pnlR >= 2) {
          return { ...p, status: 'CLOSED' as const, closedAt: now, exitPrice: price, exitReason: 'TP 2R', currentPnl: pnl, currentPnlR: pnlR, breakeven };
        }
        // Auto-close after 5 days (stale)
        const hoursOpen = (now - p.openedAt) / (1000 * 60 * 60);
        if (hoursOpen > 120 && Math.abs(pnlR) < 0.3) {
          return { ...p, status: 'CLOSED' as const, closedAt: now, exitPrice: price, exitReason: 'STALE-CLOSED', currentPnl: pnl, currentPnlR: pnlR, breakeven, flatSince: now };
        }

        return { ...p, currentPnl: pnl, currentPnlR: pnlR, breakeven };
      });

      // Log newly closed
      const newlyClosed = positions.filter(p => p.status === 'CLOSED' && !prev.trades.find(t => t.id === `trade-${p.id}`));
      const newTrades: TradeRecord[] = newlyClosed.map(p => ({
        id: `trade-${p.id}`,
        coin: p.coin,
        entry: p.entry,
        exit: p.exitPrice || p.entry,
        size: p.size,
        fee: p.size * 0.0004,
        slippage: Math.random() * 0.001 * p.size,
        resultR: p.currentPnlR,
        pnl: p.currentPnl - p.size * 0.0004,
        openedAt: p.openedAt,
        closedAt: p.closedAt || now,
        exitReason: p.exitReason || 'UNKNOWN',
        wasSkipped: false,
      }));

      const updatedTrades = [...prev.trades, ...newTrades];
      const auditReport = updatedTrades.length > 0 ? runAuditor(updatedTrades, currentRules) : prev.auditReport;

      return { ...prev, positions, trades: updatedTrades, auditReport };
    });
  }, []); // Pas de dépendances : on utilise les refs

  // Start/stop the desk
  const toggleDesk = async () => {
    // Vérifier si les données sont chargées avant de démarrer
    if (marketDataRef.current.size === 0 && !deskState?.running) {
      console.log('⏳ Données non chargées, chargement en cours...');
      await loadMarketData(dataModeRef.current);
      console.log('✅ Données chargées, démarrage des bots...');
    }
    
    setDeskState(prev => {
      if (!prev) return prev;
      const newRunning = !prev.running;
      runningRef.current = newRunning; // Mettre à jour le ref immédiatement
      
      if (newRunning) {
        // Premier cycle immédiat
        setTimeout(() => {
          runDeskCycle();
          simulateExits();
        }, 100);
        
        // Puis cycles réguliers toutes les 3 secondes
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = setInterval(() => {
          runDeskCycle();
          simulateExits();
        }, 3000);
      } else {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
      const startLog: LogEntry = newRunning ? {
        timestamp: Date.now(),
        bot: 'System',
        message: `🚀 Desk started — 6 bots online, ${marketDataRef.current.size} coins loaded, scanning...`,
        level: 'SUCCESS',
      } : {
        timestamp: Date.now(),
        bot: 'System',
        message: '⏹ Desk stopped',
        level: 'WARN',
      };

      return {
        ...prev,
        running: newRunning,
        logs: [startLog, ...prev.logs].slice(0, 200),
      };
    });
  };

  // Auto-take pending alerts after delay (simulates human response)
  useEffect(() => {
    if (!deskState?.running) return;
    const pendingAlerts = deskState.alerts.filter(a => a.decision === 'PENDING');
    if (pendingAlerts.length === 0) return;
    
    const timeout = setTimeout(() => {
      // Auto-take 70% of alerts (simulates human decision making)
      pendingAlerts.forEach(a => {
        const decision: 'TAKEN' | 'SKIPPED' = Math.random() > 0.3 ? 'TAKEN' : 'SKIPPED';
        handleGateDecision(a.id, decision);
      });
    }, 2000);
    return () => clearTimeout(timeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deskState?.alerts.length, deskState?.running]);

  // Redémarrage automatique si le desk était actif avant le refresh
  useEffect(() => {
    const startDesk = async () => {
      // Vérifier si les données sont chargées
      if (marketDataRef.current.size === 0) {
        console.log('⏳ Redémarrage automatique — chargement des données...');
        await loadMarketData(dataModeRef.current);
        console.log('✅ Données chargées, redémarrage des bots...');
      }
      
      if (deskState?.running && !intervalRef.current) {
        runningRef.current = true;
        
        // Premier cycle immédiat
        setTimeout(() => {
          runDeskCycle();
          simulateExits();
        }, 100);
        
        // Cycles réguliers
        intervalRef.current = setInterval(() => {
          runDeskCycle();
          simulateExits();
        }, 3000);
      }
    };
    
    startDesk();
  }, [deskState?.running, runDeskCycle, simulateExits, loadMarketData]);

  // Rafraîchissement automatique des données en mode live (toutes les 2 min)
  useEffect(() => {
    if (dataMode !== 'live') return;
    
    const refreshInterval = setInterval(async () => {
      console.log('🔄 Rafraîchissement automatique des données live...');
      await loadMarketData('live');
    }, 120000); // 2 minutes
    
    return () => clearInterval(refreshInterval);
  }, [dataMode, loadMarketData]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  if (!deskState) return <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">Loading desk...</div>;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center font-bold text-sm">
              GD
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Grok Trading Desk</h1>
              <p className="text-xs text-gray-400">6 bots • 1 shared machine • You keep the button</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Indicateur de mode de données */}
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${dataMode === 'live' ? 'bg-emerald-500 animate-pulse' : 'bg-blue-500'}`} />
              <span className="text-xs text-gray-400">
                {dataMode === 'live' ? 'LIVE' : 'SIM'}
              </span>
              {lastUpdate && (
                <span className="text-xs text-gray-500">
                  {new Date(lastUpdate).toLocaleTimeString()}
                </span>
              )}
            </div>
            
            {/* Toggle mode de données */}
            <button
              onClick={() => switchDataMode(dataMode === 'simulation' ? 'live' : 'simulation')}
              disabled={loading}
              className={`px-3 py-2 rounded-lg font-medium text-sm transition-all border ${
                dataMode === 'live'
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30'
                  : 'bg-blue-500/20 text-blue-400 border-blue-500/30 hover:bg-blue-500/30'
              } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
              title={dataMode === 'live' ? 'Mode LIVE : données réelles Binance' : 'Mode SIM : données simulées'}
            >
              {loading ? '⏳ Loading...' : dataMode === 'live' ? '📡 LIVE' : '🎲 SIM'}
            </button>
            
            {/* Bouton refresh pour le mode live */}
            {dataMode === 'live' && (
              <button
                onClick={refreshMarketData}
                disabled={loading}
                className="px-3 py-2 rounded-lg font-medium text-sm transition-all bg-gray-700/50 text-gray-300 border border-gray-600/30 hover:bg-gray-600/50 disabled:opacity-50"
                title="Rafraîchir les données de marché"
              >
                🔄
              </button>
            )}
            
            <div className="text-right">
              <div className="text-xs text-gray-400">Account</div>
              <div className="text-sm font-mono text-emerald-400">${accountBalance.toLocaleString()}</div>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem('grokDeskState');
                initDesk();
              }}
              className="px-3 py-2 rounded-lg font-medium text-sm transition-all bg-gray-700/50 text-gray-300 border border-gray-600/30 hover:bg-gray-600/50"
              title="Réinitialiser toutes les données"
            >
              🔄 Reset
            </button>
            <button
              onClick={toggleDesk}
              disabled={loading}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                loading
                  ? 'bg-gray-500/20 text-gray-400 border border-gray-500/30 cursor-not-allowed'
                  : deskState.running
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                  : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30'
              }`}
            >
              {loading ? '⏳ Loading...' : deskState.running ? '⏹ Stop Desk' : '▶ Start Desk'}
            </button>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="border-b border-gray-800 bg-gray-900/30">
        <div className="max-w-7xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {[
            { id: 'dashboard', label: '🖥 Dashboard' },
            { id: 'screener', label: '🔍 Screener' },
            { id: 'cartographer', label: '🗺 Cartographer' },
            { id: 'risk', label: '📐 Risk Officer' },
            { id: 'gate', label: '🚪 Gate' },
            { id: 'exit', label: '🚪 Exit Clerk' },
            { id: 'auditor', label: '📊 Auditor' },
            { id: 'rules', label: '📋 Rules' },
            { id: 'logs', label: '📝 Logs' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2.5 text-sm whitespace-nowrap transition-all border-b-2 ${
                activeTab === tab.id
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'dashboard' && <DashboardView deskState={deskState} />}
        {activeTab === 'screener' && <ScreenerView watchlist={deskState.watchlist} logs={deskState.logs} />}
        {activeTab === 'cartographer' && <CartographerView zoneMaps={deskState.zoneMaps} />}
        {activeTab === 'risk' && <RiskView tradePlans={deskState.tradePlans} accountBalance={accountBalance} rules={rules} />}
        {activeTab === 'gate' && <GateView alerts={deskState.alerts} onDecision={handleGateDecision} running={deskState.running} />}
        {activeTab === 'exit' && <ExitView positions={deskState.positions} onClose={closePosition} />}
        {activeTab === 'auditor' && <AuditorView report={deskState.auditReport} trades={deskState.trades} rules={rules} />}
        {activeTab === 'rules' && <RulesView rules={rules} />}
        {activeTab === 'logs' && <LogsView logs={deskState.logs} />}
      </main>
    </div>
  );
}

// ============ DASHBOARD VIEW ============
function DashboardView({ deskState }: { deskState: DeskState }) {
  const openPositions = deskState.positions.filter(p => p.status === 'OPEN');
  const pendingAlerts = deskState.alerts.filter(a => a.decision === 'PENDING');
  const totalPnl = deskState.trades.reduce((sum, t) => sum + t.pnl, 0);

  return (
    <div className="space-y-6">
      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Watchlist" value={deskState.watchlist.length.toString()} sub="coins" color="blue" />
        <StatCard label="Open Positions" value={openPositions.length.toString()} sub={`PnL: $${totalPnl.toFixed(2)}`} color={totalPnl >= 0 ? 'emerald' : 'red'} />
        <StatCard label="Pending Alerts" value={pendingAlerts.length.toString()} sub="awaiting your tap" color="amber" />
        <StatCard label="Total Trades" value={deskState.trades.length.toString()} sub={`of ${DEFAULT_RULES.thresholds.minTrades} needed`} color="purple" />
      </div>

      {/* Bot Status Grid */}
      <div>
        <h2 className="text-lg font-semibold mb-3 text-gray-200">Bot Fleet Status</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {deskState.botStatuses.map((bot, i) => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{['🔍', '🗺', '📐', '🚪', '📋', '📊'][i]}</span>
                  <span className="font-medium text-white">{bot.name}</span>
                </div>
                <StatusBadge status={bot.status} />
              </div>
              <p className="text-xs text-gray-500 mb-2">{bot.role}</p>
              <p className="text-sm text-gray-300 font-mono">{bot.output}</p>
              {bot.lastRun && (
                <p className="text-xs text-gray-600 mt-2">
                  Last run: {new Date(bot.lastRun).toLocaleTimeString()}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Audit Report Summary */}
      {deskState.auditReport && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <span>📊</span> Audit Report
            <span className={`ml-2 px-2 py-0.5 rounded text-xs font-medium ${
              deskState.auditReport.passed ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
            }`}>
              {deskState.auditReport.passed ? 'PASS' : 'IN PROGRESS'}
            </span>
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricBar label="Trades" value={deskState.auditReport.totalTrades} target={deskState.auditReport.thresholds.minTrades} unit="" />
            <MetricBar label="Win Rate" value={deskState.auditReport.winRate} target={deskState.auditReport.thresholds.minWinRate} unit="%" />
            <MetricBar label="Expectancy" value={deskState.auditReport.expectancy} target={deskState.auditReport.thresholds.minExpectancy} unit="R" />
            <MetricBar label="Max DD" value={deskState.auditReport.maxDrawdown} target={deskState.auditReport.thresholds.maxDrawdown} unit="%" invert />
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="font-semibold mb-3">Recent Activity</h3>
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {deskState.logs.slice(0, 20).map((log, i) => (
            <div key={i} className="flex items-start gap-2 text-sm py-1">
              <span className="text-gray-600 font-mono text-xs mt-0.5 whitespace-nowrap">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${getLogLevelColor(log.level)}`}>
                {log.bot}
              </span>
              <span className="text-gray-300">{log.message}</span>
            </div>
          ))}
          {deskState.logs.length === 0 && (
            <p className="text-gray-500 text-sm">Start the desk to see activity...</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ============ SCREENER VIEW ============
function ScreenerView({ watchlist, logs }: { watchlist: WatchlistEntry[]; logs: LogEntry[] }) {
  const screenerLogs = logs.filter(l => l.bot === 'Screener');

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-lg font-semibold mb-1">🔍 Screener — Finds the Turn</h2>
        <p className="text-sm text-gray-400 mb-4">
          Scans for confirmed daily trend changes using the three-candle rule. Short-only desk.
        </p>

        {/* Three-candle rule explanation */}
        <div className="bg-gray-800/50 rounded-lg p-4 mb-4 border border-gray-700">
          <h4 className="text-sm font-medium text-gray-300 mb-2">Three-Candle Rule (Short):</h4>
          <ol className="text-xs text-gray-400 space-y-1 list-decimal list-inside">
            <li>C1 closes down (close &lt; open)</li>
            <li>C2 closes below C1's close; C2 does NOT take out C1's high</li>
            <li>C3 body closes below C2's close; neither C2 nor C3 touches C1's high</li>
          </ol>
          <p className="text-xs text-gray-500 mt-2">Dojis are valid. C2 doesn't have to be red.</p>
        </div>

        {/* Watchlist table */}
        {watchlist.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-xs border-b border-gray-800">
                  <th className="text-left py-2 px-3">Coin</th>
                  <th className="text-left py-2 px-3">Tag</th>
                  <th className="text-right py-2 px-3">Anchor High</th>
                  <th className="text-right py-2 px-3">Flip Date</th>
                  <th className="text-left py-2 px-3">Direction</th>
                </tr>
              </thead>
              <tbody>
                {watchlist.map((entry, i) => (
                  <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="py-2 px-3 font-medium text-white">{entry.coin}</td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        entry.tag === 'PRIME' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-blue-500/20 text-blue-400'
                      }`}>
                        {entry.tag}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right font-mono">${entry.anchorHigh.toFixed(2)}</td>
                    <td className="py-2 px-3 text-right text-gray-400">{new Date(entry.flipDate).toLocaleDateString()}</td>
                    <td className="py-2 px-3">
                      <span className="text-red-400">▼ SHORT</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No coins on watchlist yet. Start the desk.</p>
        )}
      </div>

      {/* Screener logs */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="font-semibold mb-3">Screener Logs</h3>
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {screenerLogs.slice(0, 30).map((log, i) => (
            <div key={i} className="flex items-start gap-2 text-sm py-0.5">
              <span className="text-gray-600 font-mono text-xs">{new Date(log.timestamp).toLocaleTimeString()}</span>
              <span className="text-gray-300">{log.message}</span>
            </div>
          ))}
          {screenerLogs.length === 0 && <p className="text-gray-500 text-sm">No logs yet.</p>}
        </div>
      </div>
    </div>
  );
}

// ============ CARTOGRAPHER VIEW ============
function CartographerView({ zoneMaps }: { zoneMaps: Map<string, import('./types').ZoneMap> }) {
  const entries = Array.from(zoneMaps.entries());

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-lg font-semibold mb-1">🗺 Cartographer — Maps the Zone</h2>
        <p className="text-sm text-gray-400 mb-4">
          Finds Fair Value Gaps (FVGs) on the 4H across the full impulse. Builds a ladder of zones top to bottom.
        </p>

        {entries.length > 0 ? (
          <div className="space-y-4">
            {entries.map(([coin, zoneMap]) => (
              <div key={coin} className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium text-white">{coin}</h4>
                  <span className="text-xs text-gray-500">
                    {zoneMap.zones.length} zones • {zoneMap.zones.filter(z => z.confirmed).length} confirmed
                  </span>
                </div>
                <div className="space-y-1">
                  {zoneMap.zones.map((zone: FairValueGap, i: number) => (
                    <div key={zone.id || i} className="flex items-center gap-3 text-sm py-1 px-2 rounded bg-gray-900/50">
                      <div className="w-2 h-2 rounded-full" style={{
                        backgroundColor: zone.confirmed ? '#10b981' : zone.status === 'TESTED' ? '#f59e0b' : '#6b7280'
                      }} />
                      <span className="font-mono text-xs text-gray-300">
                        ${zone.zoneBottom.toFixed(2)} — ${zone.zoneTop.toFixed(2)}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        zone.confirmed ? 'bg-emerald-500/20 text-emerald-400' :
                        zone.status === 'TESTED' ? 'bg-amber-500/20 text-amber-400' :
                        zone.status === 'FILLED' ? 'bg-gray-500/20 text-gray-400' :
                        'bg-gray-700 text-gray-400'
                      }`}>
                        {zone.confirmed ? 'CONFIRMED' : zone.status}
                      </span>
                      <div className="flex-1" />
                      <div className="h-2 rounded bg-gray-700" style={{ width: '100px' }}>
                        <div
                          className="h-full rounded bg-gradient-to-r from-emerald-500 to-cyan-500"
                          style={{ width: zone.confirmed ? '100%' : zone.status === 'TESTED' ? '60%' : '20%' }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No zones mapped yet. Start the desk.</p>
        )}
      </div>
    </div>
  );
}

// ============ RISK VIEW ============
function RiskView({ tradePlans, accountBalance, rules }: { tradePlans: TradePlan[]; accountBalance: number; rules: DeskRules }) {
  return (
    <div className="space-y-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-lg font-semibold mb-1">📐 Risk Officer — Sizes Before You Get Excited</h2>
        <p className="text-sm text-gray-400 mb-4">
          Never sees a chart. Only does math. Every position sized against hard risk cap.
        </p>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="bg-gray-800/50 rounded-lg p-3 text-center">
            <div className="text-xs text-gray-400">Account</div>
            <div className="text-lg font-mono text-white">${accountBalance.toLocaleString()}</div>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3 text-center">
            <div className="text-xs text-gray-400">Risk/Trade</div>
            <div className="text-lg font-mono text-amber-400">{rules.riskPerTrade}%</div>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3 text-center">
            <div className="text-xs text-gray-400">Add Risk</div>
            <div className="text-lg font-mono text-blue-400">{rules.addRisk}%</div>
          </div>
        </div>

        <div className="bg-gray-800/30 rounded-lg p-3 mb-4 border border-gray-700/50">
          <p className="text-xs text-gray-400">
            <strong className="text-gray-300">Rule:</strong> Add 0.5% risk only after previous entry is at breakeven. The ladder can only grow on money that's already safe.
          </p>
        </div>

        {tradePlans.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-xs border-b border-gray-800">
                  <th className="text-left py-2 px-3">Coin</th>
                  <th className="text-left py-2 px-3">Status</th>
                  <th className="text-right py-2 px-3">Entry</th>
                  <th className="text-right py-2 px-3">Stop</th>
                  <th className="text-right py-2 px-3">Size (USDT)</th>
                  <th className="text-right py-2 px-3">Risk %</th>
                  <th className="text-center py-2 px-3">Add #</th>
                </tr>
              </thead>
              <tbody>
                {tradePlans.map((plan, i) => (
                  <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="py-2 px-3 font-medium text-white">{plan.coin}</td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        plan.status === 'APPROVED' ? 'bg-emerald-500/20 text-emerald-400' :
                        plan.status === 'REJECTED' ? 'bg-red-500/20 text-red-400' :
                        'bg-gray-500/20 text-gray-400'
                      }`}>
                        {plan.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right font-mono">${plan.entry.toFixed(2)}</td>
                    <td className="py-2 px-3 text-right font-mono text-red-400">${plan.stop.toFixed(2)}</td>
                    <td className="py-2 px-3 text-right font-mono">${plan.size.toFixed(2)}</td>
                    <td className="py-2 px-3 text-right font-mono">{plan.riskPct}%</td>
                    <td className="py-2 px-3 text-center">#{plan.addNumber}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No trade plans yet.</p>
        )}
      </div>
    </div>
  );
}

// ============ GATE VIEW ============
function GateView({ alerts, onDecision, running }: { alerts: GateAlert[]; onDecision: (id: string, d: 'TAKEN' | 'SKIPPED') => void; running: boolean }) {
  const pending = alerts.filter(a => a.decision === 'PENDING');
  const decided = alerts.filter(a => a.decision !== 'PENDING');

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-lg font-semibold mb-1">🚪 Gate — It Pings, You Press</h2>
        <p className="text-sm text-gray-400 mb-4">
          Everything above runs by itself. Execution doesn't. The bot has never placed a trade on its own.
        </p>

        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-4">
          <p className="text-xs text-amber-300">
            ⚡ The full-auto crowd will call this slow. You miss alerts while you sleep. You accept that. "It executes without me" is exactly the risk that turns a good week into a wiped account.
          </p>
        </div>

        {/* Pending alerts */}
        {pending.length > 0 && (
          <div className="mb-6">
            <h3 className="font-medium text-amber-400 mb-3">⏳ Awaiting Your Tap ({pending.length})</h3>
            <div className="space-y-3">
              {pending.map(alert => (
                <div key={alert.id} className="bg-gray-800 border border-amber-500/30 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-white">{alert.tradePlan.coin}</span>
                      <span className="text-xs text-gray-400">Add #{alert.tradePlan.addNumber}</span>
                    </div>
                    <span className="text-xs text-gray-500">{new Date(alert.sentAt).toLocaleTimeString()}</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-sm">
                    <div><span className="text-gray-400 text-xs">Entry:</span><br/><span className="font-mono">${alert.tradePlan.entry.toFixed(2)}</span></div>
                    <div><span className="text-gray-400 text-xs">Stop:</span><br/><span className="font-mono text-red-400">${alert.tradePlan.stop.toFixed(2)}</span></div>
                    <div><span className="text-gray-400 text-xs">Size:</span><br/><span className="font-mono">${alert.tradePlan.size.toFixed(2)}</span></div>
                    <div><span className="text-gray-400 text-xs">Risk:</span><br/><span className="font-mono">{alert.tradePlan.riskPct}%</span></div>
                  </div>
                  {running && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => onDecision(alert.id, 'TAKEN')}
                        className="px-4 py-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded text-sm font-medium hover:bg-emerald-500/30 transition"
                      >
                        ✓ TAKE
                      </button>
                      <button
                        onClick={() => onDecision(alert.id, 'SKIPPED')}
                        className="px-4 py-1.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded text-sm font-medium hover:bg-red-500/30 transition"
                      >
                        ✗ SKIP
                      </button>
                    </div>
                  )}
                  {!running && (
                    <p className="text-xs text-gray-500">Start the desk to enable manual decisions (auto-take is active)</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Decided alerts */}
        {decided.length > 0 && (
          <div>
            <h3 className="font-medium text-gray-400 mb-3">History ({decided.length})</h3>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {decided.slice().reverse().map(alert => (
                <div key={alert.id} className="flex items-center gap-3 text-sm py-1 px-2 rounded bg-gray-800/30">
                  <span className="font-medium text-white">{alert.tradePlan.coin}</span>
                  <span className={`px-1.5 py-0.5 rounded text-xs ${
                    alert.decision === 'TAKEN' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                  }`}>
                    {alert.decision}
                  </span>
                  <span className="text-gray-500 text-xs">
                    ${alert.tradePlan.entry.toFixed(2)} → stop ${alert.tradePlan.stop.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {alerts.length === 0 && (
          <p className="text-gray-500 text-sm">No alerts yet. Start the desk to generate trade signals.</p>
        )}
      </div>
    </div>
  );
}

// ============ EXIT VIEW ============
function ExitView({ positions, onClose }: { positions: Position[]; onClose: (id: string, reason: string) => void }) {
  const open = positions.filter(p => p.status === 'OPEN');
  const closed = positions.filter(p => p.status === 'CLOSED');

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-lg font-semibold mb-1">📋 Exit Clerk — Closes Without Negotiating</h2>
        <p className="text-sm text-gray-400 mb-4">
          Entries get all the attention. Exits are where accounts die.
        </p>

        <div className="space-y-2 mb-4">
          <div className="bg-gray-800/50 rounded p-2 text-xs text-gray-400">
            <strong className="text-gray-300">Rule 1:</strong> Daily close above anchor → close immediately. No "let's see the next candle."
          </div>
          <div className="bg-gray-800/50 rounded p-2 text-xs text-gray-400">
            <strong className="text-gray-300">Rule 2:</strong> State flips to neutral while in profit → hold. Don't cut a winner.
          </div>
          <div className="bg-gray-800/50 rounded p-2 text-xs text-gray-400">
            <strong className="text-gray-300">Rule 3:</strong> Flat for 72h → STALE flag, human decides.
          </div>
        </div>

        {/* Open positions */}
        {open.length > 0 && (
          <div className="mb-6">
            <h3 className="font-medium text-emerald-400 mb-3">Open Positions ({open.length})</h3>
            <div className="space-y-2">
              {open.map(pos => (
                <div key={pos.id} className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">{pos.coin}</span>
                      <span className="text-xs text-gray-500">Add #{pos.addNumber}</span>
                      {pos.breakeven && <span className="text-xs bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">BE</span>}
                    </div>
                    <span className={`font-mono text-sm ${pos.currentPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {pos.currentPnlR >= 0 ? '+' : ''}{pos.currentPnlR.toFixed(2)}R
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs mb-2">
                    <div><span className="text-gray-500">Entry:</span> <span className="font-mono">${pos.entry.toFixed(2)}</span></div>
                    <div><span className="text-gray-500">Stop:</span> <span className="font-mono text-red-400">${pos.stop.toFixed(2)}</span></div>
                    <div><span className="text-gray-500">Size:</span> <span className="font-mono">${pos.size.toFixed(0)}</span></div>
                    <div><span className="text-gray-500">PnL:</span> <span className="font-mono">${pos.currentPnl.toFixed(2)}</span></div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => onClose(pos.id, 'MANUAL-CLOSE')} className="px-2 py-1 bg-gray-700 text-gray-300 rounded text-xs hover:bg-gray-600">Close</button>
                    <button onClick={() => onClose(pos.id, 'STOP-MANUAL')} className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs hover:bg-red-500/30">Stop Out</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Closed positions */}
        {closed.length > 0 && (
          <div>
            <h3 className="font-medium text-gray-400 mb-3">Closed ({closed.length})</h3>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {closed.slice().reverse().map(pos => (
                <div key={pos.id} className="flex items-center gap-3 text-sm py-1 px-2 rounded bg-gray-800/30">
                  <span className="font-medium text-white">{pos.coin}</span>
                  <span className={`px-1.5 py-0.5 rounded text-xs ${
                    (pos.currentPnlR || 0) >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                  }`}>
                    {(pos.currentPnlR || 0) >= 0 ? '+' : ''}{(pos.currentPnlR || 0).toFixed(2)}R
                  </span>
                  <span className="text-gray-500 text-xs">{pos.exitReason}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {positions.length === 0 && (
          <p className="text-gray-500 text-sm">No positions yet. Take a trade from the Gate.</p>
        )}
      </div>
    </div>
  );
}

// ============ AUDITOR VIEW ============
function AuditorView({ report, trades, rules }: { report: AuditReport | null; trades: TradeRecord[]; rules: DeskRules }) {
  const realTrades = trades.filter(t => !t.wasSkipped);
  const skippedTrades = trades.filter(t => t.wasSkipped);

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-lg font-semibold mb-1">📊 Auditor — Grades the Desk (Including You)</h2>
        <p className="text-sm text-gray-400 mb-4">
          Every fill, fee and slip on its own line. Every trade logged in R. Thresholds locked before the run.
        </p>

        {/* Go/No-Go Thresholds */}
        {report && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <h3 className="font-medium">Go/No-Go Report</h3>
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                report.passed ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
              }`}>
                {report.passed ? '✓ PASS' : '⏳ IN PROGRESS'}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <ThresholdCard
                label="Total Trades"
                value={report.totalTrades}
                threshold={rules.thresholds.minTrades}
                operator="≥"
                passed={report.totalTrades >= rules.thresholds.minTrades}
              />
              <ThresholdCard
                label="Win Rate"
                value={`${report.winRate.toFixed(1)}%`}
                threshold={`${rules.thresholds.minWinRate}%`}
                operator="≥"
                passed={report.winRate >= rules.thresholds.minWinRate}
              />
              <ThresholdCard
                label="Expectancy"
                value={`${report.expectancy.toFixed(2)}R`}
                threshold={`${rules.thresholds.minExpectancy}R`}
                operator="≥"
                passed={report.expectancy >= rules.thresholds.minExpectancy}
              />
              <ThresholdCard
                label="Max Drawdown"
                value={`${report.maxDrawdown.toFixed(1)}%`}
                threshold={`${rules.thresholds.maxDrawdown}%`}
                operator="≤"
                passed={report.maxDrawdown <= rules.thresholds.maxDrawdown}
              />
            </div>
          </div>
        )}

        {/* Equity Curve */}
        {report && report.equityCurve.length > 1 && (
          <div className="mb-6">
            <h3 className="font-medium mb-3">Equity Curve</h3>
            <div className="bg-gray-800 rounded-lg p-4 h-40 flex items-end gap-0.5">
              {report.equityCurve.slice(1).map((point, i) => {
                const maxEq = Math.max(...report.equityCurve.map(p => Math.abs(p.equity)), 1);
                const height = Math.abs(point.equity) / maxEq * 100;
                return (
                  <div
                    key={i}
                    className={`flex-1 rounded-t ${point.equity >= 0 ? 'bg-emerald-500/60' : 'bg-red-500/60'}`}
                    style={{ height: `${Math.max(height, 2)}%` }}
                    title={`${point.equity.toFixed(2)}`}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Trade Journal */}
        <div>
          <h3 className="font-medium mb-3">Trade Journal ({realTrades.length} trades, {skippedTrades.length} skipped)</h3>
          {realTrades.length > 0 ? (
            <div className="overflow-x-auto max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-900">
                  <tr className="text-gray-400 border-b border-gray-800">
                    <th className="text-left py-1.5 px-2">Coin</th>
                    <th className="text-right py-1.5 px-2">Entry</th>
                    <th className="text-right py-1.5 px-2">Exit</th>
                    <th className="text-right py-1.5 px-2">Size</th>
                    <th className="text-right py-1.5 px-2">Fee</th>
                    <th className="text-right py-1.5 px-2">Result (R)</th>
                    <th className="text-right py-1.5 px-2">PnL</th>
                    <th className="text-left py-1.5 px-2">Exit Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {realTrades.slice().reverse().map((trade, i) => (
                    <tr key={i} className="border-b border-gray-800/30">
                      <td className="py-1 px-2 font-medium text-white">{trade.coin}</td>
                      <td className="py-1 px-2 text-right font-mono">${trade.entry.toFixed(2)}</td>
                      <td className="py-1 px-2 text-right font-mono">${trade.exit.toFixed(2)}</td>
                      <td className="py-1 px-2 text-right font-mono">${trade.size.toFixed(0)}</td>
                      <td className="py-1 px-2 text-right font-mono text-gray-400">${trade.fee.toFixed(2)}</td>
                      <td className={`py-1 px-2 text-right font-mono ${trade.resultR >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {trade.resultR >= 0 ? '+' : ''}{trade.resultR.toFixed(2)}R
                      </td>
                      <td className={`py-1 px-2 text-right font-mono ${trade.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        ${trade.pnl.toFixed(2)}
                      </td>
                      <td className="py-1 px-2 text-gray-400">{trade.exitReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No trades logged yet.</p>
          )}
        </div>

        {/* Skipped trades */}
        {skippedTrades.length > 0 && (
          <div className="mt-4">
            <h4 className="text-sm font-medium text-gray-400 mb-2">Skipped Alerts (what-if)</h4>
            <div className="space-y-1">
              {skippedTrades.slice(-5).map((t, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-1 px-2 bg-gray-800/30 rounded">
                  <span className="text-white font-medium">{t.coin}</span>
                  <span className="text-gray-500">would have been:</span>
                  <span className={t.resultR >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {t.resultR >= 0 ? '+' : ''}{t.resultR.toFixed(2)}R
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============ RULES VIEW ============
function RulesView({ rules }: { rules: DeskRules }) {
  return (
    <div className="space-y-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h2 className="text-lg font-semibold mb-4">📋 Desk Rules — Single Source of Truth</h2>
        
        <div className="bg-gray-950 rounded-lg p-4 font-mono text-sm text-gray-300 overflow-x-auto">
          <pre>{`# DESK_RULES.md — single source of truth

Market: ${rules.market}. ${rules.direction === 'SHORT_ONLY' ? 'Short-only.' : ''}

Trend filter (1D): three-candle rule.
  - C1 closes down.
  - C2 closes below C1's close; C2 does not take out C1's high.
  - C3 body closes below C2's close; C2 and C3 do not touch C1's high.
  - Dojis are valid. C2 does not have to be red.

Zones (4H): FVGs across the full impulse, anchor high → current low.
  A partial wick test counts as a test.

Confirmation: 1H.

Risk: ${rules.riskPerTrade}% per trade.
Add: ${rules.addRisk}% risk only after previous entry is at breakeven.

Exits:
  - 1D close above anchor → close immediately.
  - State NEUTRAL while in profit → hold.
  - Flat for ${rules.staleThresholdHours}h → flag STALE, human decides.

Execution: NEVER. Alerts only.

Go/No-Go Thresholds (locked before first run):
  - Trades ≥ ${rules.thresholds.minTrades}
  - Win rate ≥ ${rules.thresholds.minWinRate}%
  - Expectancy ≥ +${rules.thresholds.minExpectancy}R
  - Max drawdown ≤ ${rules.thresholds.maxDrawdown}%`}</pre>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="font-semibold mb-3">Bot Charters</h3>
        <div className="space-y-3">
          {[
            { name: 'Screener', charter: 'You own one job: finding coins where the daily trend has flipped down. Output: watchlist.csv. You stop at the watchlist. You never map zones or size positions.' },
            { name: 'Cartographer', charter: 'You own zone mapping. Find all 4H FVGs, rank as ladder. Mark TESTED on wick entry. Confirm on 1H. Output: zones.csv. You stop at the map.' },
            { name: 'Risk Officer', charter: 'You never look at charts. You only do math. Calculate size from balance, stop, risk%. Approve adds only if previous at breakeven. Output: trade_plan.csv.' },
            { name: 'Gate', charter: 'You are the only bot that talks to me. Send Telegram with coin, zone, entry, stop, size, risk%, chart. Wait for TAKEN or SKIPPED. Never send to exchange.' },
            { name: 'Exit Clerk', charter: 'You own open positions. Check exit rules on every 4H/daily close. Never argue with a rule. Never suggest "waiting one more candle."' },
            { name: 'Auditor', charter: 'You own the journal. Log every trade in R. Log every SKIPPED alert. Report against thresholds weekly. You may NEVER suggest changing a threshold after seeing results.' },
          ].map((bot, i) => (
            <div key={i} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
              <h4 className="text-sm font-medium text-emerald-400 mb-1">{bot.name}</h4>
              <p className="text-xs text-gray-400">{bot.charter}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============ LOGS VIEW ============
function LogsView({ logs }: { logs: LogEntry[] }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <h2 className="text-lg font-semibold mb-4">📝 System Logs</h2>
      <div className="space-y-0.5 max-h-[600px] overflow-y-auto font-mono text-xs">
        {logs.map((log, i) => (
          <div key={i} className="flex items-start gap-2 py-0.5 hover:bg-gray-800/30 px-1 rounded">
            <span className="text-gray-600 whitespace-nowrap">{new Date(log.timestamp).toLocaleTimeString()}</span>
            <span className={`px-1 py-0 rounded text-[10px] ${getLogLevelColor(log.level)}`}>{log.level}</span>
            <span className="text-cyan-400/70 whitespace-nowrap">[{log.bot}]</span>
            <span className="text-gray-300">{log.message}</span>
          </div>
        ))}
        {logs.length === 0 && (
          <p className="text-gray-500">No logs yet. Start the desk to see activity.</p>
        )}
      </div>
    </div>
  );
}

// ============ UTILITY COMPONENTS ============
function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  const colors: Record<string, string> = {
    blue: 'from-blue-500/10 to-blue-600/5 border-blue-500/20',
    emerald: 'from-emerald-500/10 to-emerald-600/5 border-emerald-500/20',
    red: 'from-red-500/10 to-red-600/5 border-red-500/20',
    amber: 'from-amber-500/10 to-amber-600/5 border-amber-500/20',
    purple: 'from-purple-500/10 to-purple-600/5 border-purple-500/20',
  };

  return (
    <div className={`bg-gradient-to-br ${colors[color]} border rounded-xl p-4`}>
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="text-2xl font-bold text-white font-mono">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{sub}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    IDLE: 'bg-gray-700 text-gray-300',
    RUNNING: 'bg-blue-500/20 text-blue-400 animate-pulse',
    ERROR: 'bg-red-500/20 text-red-400',
    WAITING: 'bg-amber-500/20 text-amber-400',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] || colors.IDLE}`}>
      {status}
    </span>
  );
}

function MetricBar({ label, value, target, unit, invert }: { label: string; value: number; target: number; unit: string; invert?: boolean }) {
  const pct = invert ? Math.min(100, (value / target) * 100) : Math.min(100, (value / target) * 100);
  const passed = invert ? value <= target : value >= target;

  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-400">{label}</span>
        <span className={passed ? 'text-emerald-400' : 'text-amber-400'}>
          {typeof value === 'number' ? value.toFixed(1) : value}{unit} / {target}{unit}
        </span>
      </div>
      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${passed ? 'bg-emerald-500' : 'bg-amber-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ThresholdCard({ label, value, threshold, operator, passed }: {
  label: string; value: string | number; threshold: string | number; operator: string; passed: boolean;
}) {
  return (
    <div className={`rounded-lg p-3 border ${passed ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}>
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className={`text-lg font-mono font-bold ${passed ? 'text-emerald-400' : 'text-amber-400'}`}>
        {value}
      </div>
      <div className="text-xs text-gray-500 mt-1">
        {operator} {threshold} {passed ? '✓' : '⏳'}
      </div>
    </div>
  );
}

function getLogLevelColor(level: string): string {
  switch (level) {
    case 'SUCCESS': return 'bg-emerald-500/20 text-emerald-400';
    case 'WARN': return 'bg-amber-500/20 text-amber-400';
    case 'ERROR': return 'bg-red-500/20 text-red-400';
    default: return 'bg-blue-500/20 text-blue-400';
  }
}
