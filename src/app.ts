/** Dashboard web du bot : équité en temps réel, positions, trades, boutons timeframe.
 *
 * Lancement : npm run dev  -> http://127.0.0.1:8050
 * (Remplace le dashboard Dash Python : ici serveur HTTP natif + polling JSON.)
 */
import http from "node:http";

import * as config from "./config.js";
import { engine, type Position } from "./bot.js";
import { unrealizedPnl } from "./strategy.js";

const HOST = "127.0.0.1";
const PORT = 8050;

async function uPnl(pos: Position): Promise<number> {
  try {
    const price = await engine.lastPrice(pos.symbol);
    return unrealizedPnl(pos.entry_price, pos.quantity, pos.side, price);
  } catch {
    return 0.0;
  }
}

interface Snapshot {
  running: boolean;
  live: boolean;
  capital: number;
  equity: number;
  timeframe: string;
  symbols: string[];
  tradesCount: number;
  winRate: string;
  positions: (Position & { upnl: number })[];
  trades: ReturnType<typeof buildTrades>;
  equityHistory: [number, number][];
}

function buildTrades() {
  return engine.trades.slice(-15).reverse();
}

async function getSnapshot(): Promise<Snapshot> {
  const positions = [...engine.positions.values()];
  const pnls = await Promise.all(positions.map(uPnl));
  const equity = engine.capital + pnls.reduce((a, b) => a + b, 0);
  const wins = engine.trades.filter((t) => t.pnl > 0).length;
  const n = engine.trades.length;
  return {
    running: engine.running,
    live: process.env.BOT_LIVE === "1",
    capital: engine.capital,
    equity,
    timeframe: engine.timeframe,
    symbols: config.SYMBOLS,
    tradesCount: n,
    winRate: n ? `${((wins / n) * 100).toFixed(0)}%` : "—",
    positions: positions.map((p, i) => ({ ...p, upnl: pnls[i] ?? 0 })),
    trades: buildTrades(),
    equityHistory: engine.equityHistory,
  };
}

const HTML_PAGE = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Bot Momentum RSI</title>
<style>
  body { background:#1a1d27; color:#e6e6e6; font-family: system-ui, sans-serif; margin:2rem; }
  h1 { font-size:1.4rem; } h2 { font-size:1.1rem; margin-top:2rem; }
  .status { padding:.5rem .8rem; border-radius:6px; background:#242836; margin-bottom:1rem; }
  .tf-btn, .controls button { background:#2c3140; color:#e6e6e6; border:1px solid #444a5e;
      border-radius:6px; padding:.35rem .8rem; margin-right:.4rem; cursor:pointer; }
  .tf-btn.active { background:#00b894; color:#08281f; font-weight:bold; }
  table { border-collapse: collapse; width:100%; margin-top:.5rem; }
  th, td { border:1px solid #333a4d; padding:.35rem .6rem; text-align:right; }
  th { background:#242836; } td:first-child, th:first-child { text-align:left; }
  .pos { color:#00b894; } .neg { color:#ff6b6b; }
  canvas { background:#242836; border-radius:8px; margin-top:1rem; width:100%; height:380px; }
</style>
</head>
<body>
  <h1>🤖 Bot Momentum RSI — Paper Trading</h1>
  <div class="status" id="status">…</div>
  <div>Timeframe : <span id="tf-buttons"></span></div>
  <div class="controls" style="margin-top:1rem;">
    <button id="btn-pause">⏸ Pause</button>
    <button id="btn-start">▶ Démarrer</button>
    <button id="btn-close-all">🔴 Fermer toutes les positions</button>
  </div>
  <canvas id="equity-canvas" width="1100" height="380"></canvas>
  <h2>Positions ouvertes</h2>
  <div id="positions-table"><em>Aucune position ouverte.</em></div>
  <h2>Derniers trades</h2>
  <div id="trades-table"><em>Aucun trade clôturé.</em></div>
<script>
const fmt = (x, d=4) => Number(x).toFixed(d);
const pnlCell = v => '<td class="' + (v>=0?'pos':'neg') + '">' +
                     (v>=0?'+':'') + fmt(v,2) + '$</td>';

function drawEquity(hist) {
  const c = document.getElementById('equity-canvas');
  const ctx = c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  if (!hist.length) return;
  const ys = hist.map(h=>h[1]);
  const min = Math.min(...ys), max = Math.max(...ys);
  const pad = 30;
  const X = i => pad + i*(c.width-2*pad)/Math.max(1,hist.length-1);
  const Y = v => c.height-pad - (v-min)*(c.height-2*pad)/Math.max(1e-9,max-min);
  ctx.strokeStyle='#444a5e'; ctx.setLineDash([4,4]); ctx.beginPath();
  const y0 = Y(1000); ctx.moveTo(pad,y0); ctx.lineTo(c.width-pad,y0); ctx.stroke();
  ctx.setLineDash([]); ctx.strokeStyle='#00b894'; ctx.lineWidth=2; ctx.beginPath();
  hist.forEach((h,i)=> i?ctx.lineTo(X(i),Y(h[1])):ctx.moveTo(X(i),Y(h[1])));
  ctx.stroke();
  ctx.fillStyle='#e6e6e6'; ctx.font='12px sans-serif';
  ctx.fillText('Équité ($, PnL flottant inclus) — min '+fmt(min,2)+'$ / max '+fmt(max,2)+'$', pad, 18);
}

async function refresh() {
  const s = await (await fetch('/api/state')).json();
  document.getElementById('status').textContent =
    (s.running ? '🟢 EN COURS' : '🔴 EN PAUSE') +
    ' | Équité: ' + fmt(s.equity,2) + '$ | Capital réalisé: ' + fmt(s.capital,2) +
    '$ | Trades: ' + s.tradesCount + ' | Win rate: ' + s.winRate +
    ' | Paires: ' + s.symbols.map(x=>x.split('/')[0]).join(', ');
  // boutons timeframe
  const tfDiv = document.getElementById('tf-buttons');
  if (!tfDiv.childElementCount) {
    for (const tf of ['1m','3m','5m','15m','30m','1h','4h']) {
      const b = document.createElement('button');
      b.className='tf-btn'; b.textContent=tf;
      b.onclick = async () => { await fetch('/api/timeframe?tf='+tf, {method:'POST'}); refresh(); };
      tfDiv.appendChild(b);
    }
  }
  [...tfDiv.children].forEach(b => b.classList.toggle('active', b.textContent===s.timeframe));
  // positions
  if (s.positions.length) {
    document.getElementById('positions-table').innerHTML =
      '<table><tr><th>Symbole</th><th>Côté</th><th>Entrée</th><th>Qté</th><th>Marge</th>' +
      '<th>TP</th><th>SL</th><th>PnL flottant</th></tr>' +
      s.positions.map(p=>'<tr><td>'+p.symbol+'</td><td>'+p.side+'</td><td>'+fmt(p.entry_price)+
      '</td><td>'+fmt(p.quantity,6)+'</td><td>'+fmt(p.margin,2)+'$ x'+p.leverage.toFixed(0)+
      '</td><td>'+fmt(p.tp_price)+'</td><td>'+fmt(p.sl_price)+'</td>'+pnlCell(p.upnl)+'</td></tr>').join('') +
      '</table>';
  } else {
    document.getElementById('positions-table').innerHTML = '<em>Aucune position ouverte.</em>';
  }
  // trades
  if (s.trades.length) {
    document.getElementById('trades-table').innerHTML =
      '<table><tr><th>Clôture</th><th>Symbole</th><th>Côté</th><th>Entrée</th><th>Sortie</th>' +
      '<th>Raison</th><th>PnL</th></tr>' +
      s.trades.map(t=>'<tr><td>'+new Date(t.closed_at*1000).toLocaleString('fr-FR')+
      '</td><td>'+t.symbol+'</td><td>'+t.side+'</td><td>'+fmt(t.entry_price)+
      '</td><td>'+fmt(t.exit_price)+'</td><td>'+t.reason+'</td>'+pnlCell(t.pnl)+'</tr>').join('') +
      '</table>';
  } else {
    document.getElementById('trades-table').innerHTML = '<em>Aucun trade clôturé.</em>';
  }
  drawEquity(s.equityHistory);
}

document.getElementById('btn-pause').onclick   = async () => { await fetch('/api/stop',{method:'POST'}); refresh(); };
document.getElementById('btn-start').onclick   = async () => { await fetch('/api/start',{method:'POST'}); refresh(); };
document.getElementById('btn-close-all').onclick = async () => { await fetch('/api/close_all',{method:'POST'}); refresh(); };
refresh();
setInterval(refresh, 10000);
</script>
</body>
</html>`;

export function makeServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
    try {
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(HTML_PAGE);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/state") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(await getSnapshot()));
        return;
      }
      if (req.method === "POST") {
        switch (url.pathname) {
          case "/api/timeframe": {
            const tf = url.searchParams.get("tf");
            if (tf) engine.setTimeframe(tf);
            break;
          }
          case "/api/start":
            engine.start();
            break;
          case "/api/stop":
            engine.stop();
            break;
          case "/api/close_all":
            await engine.closeAll();
            break;
          default:
            res.writeHead(404);
            res.end("Not found");
            return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  });
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  engine.start();
  makeServer().listen(PORT, HOST, () => {
    console.log(`Dashboard disponible sur http://${HOST}:${PORT}`);
  });
}
