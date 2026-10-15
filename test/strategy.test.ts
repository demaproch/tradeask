/** Tests unitaires de la logique stratégie (offline). */
import assert from "node:assert/strict";

import {
  computeRsi,
  detectSignal,
  positionSizing,
  checkExit,
  unrealizedPnl,
  type Candle,
} from "../src/strategy.js";

function linspace(start: number, stop: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(start + ((stop - start) * i) / (n - 1));
  return out;
}

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((c, i) => ({ timestamp: i, open: c, high: c, low: c, close: c }));
}

const tests: Array<[string, () => void]> = [];
function test(name: string, fn: () => void): void {
  tests.push([name, fn]);
}

test("rsi all gains", () => {
  const closes: number[] = [];
  for (let i = 1; i < 20; i++) closes.push(i);
  assert.ok(Math.abs(computeRsi(closes, 6) - 100.0) < 1e-9);
});

test("rsi all losses", () => {
  const closes: number[] = [];
  for (let i = 20; i > 1; i--) closes.push(i);
  assert.ok(computeRsi(closes, 6) < 1e-9);
});

test("long signal", () => {
  // baisse puis forte hausse sur les 10 dernières bougies
  const closes = [100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0].concat(
    linspace(100, 101.2, 10),
  ); // +1.2 % > 0.55 %
  const sig = detectSignal("BTC/USDT:USDT", candlesFromCloses(closes));
  assert.ok(sig !== null && sig.direction === "LONG");
  assert.ok(sig.variation > 0.0055 && sig.rsi > 52);
});

test("short signal", () => {
  const closes = [100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0].concat(
    linspace(100, 98.8, 10),
  ); // -1.2 %
  const sig = detectSignal("ETH/USDT:USDT", candlesFromCloses(closes));
  assert.ok(sig !== null && sig.direction === "SHORT");
  assert.ok(sig.variation < -0.0055 && sig.rsi < 48);
});

test("no signal small move", () => {
  const closes = [100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0].concat(
    linspace(100, 100.2, 10),
  ); // +0.2 % < seuil
  assert.equal(detectSignal("SOL/USDT:USDT", candlesFromCloses(closes)), null);
});

test("sizing", () => {
  const s = positionSizing(1000, 50000, { riskPct: 0.08, leverage: 10, maxLeverage: 12 });
  assert.ok(Math.abs(s.margin - 80) < 1e-9);
  assert.ok(Math.abs(s.notional - 800) < 1e-9);
  assert.ok(Math.abs(s.quantity - 800 / 50000) < 1e-12);
});

test("tp/sl long", () => {
  assert.equal(checkExit(100, 1, "LONG", 102.9), "TP"); // +2.9 % >= 2.8
  assert.equal(checkExit(100, 1, "LONG", 98.9), "SL"); // -1.1 % <= -1
  assert.equal(checkExit(100, 1, "LONG", 101.0), null);
});

test("tp/sl short", () => {
  assert.equal(checkExit(100, 1, "SHORT", 97.0), "TP"); // short gagne si -3 %
  assert.equal(checkExit(100, 1, "SHORT", 101.5), "SL");
  assert.equal(checkExit(100, 1, "SHORT", 99.5), null);
});

test("upnl", () => {
  assert.ok(Math.abs(unrealizedPnl(100, 2, "LONG", 105) - 10) < 1e-9);
  assert.ok(Math.abs(unrealizedPnl(100, 2, "SHORT", 105) + 10) < 1e-9);
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`OK ${name}`);
  } catch (e) {
    failures++;
    console.error(`ECHEC ${name}:`, e);
  }
}
if (failures > 0) {
  console.error(`${failures}/${tests.length} tests échoués`);
  process.exit(1);
}
console.log(`${tests.length} tests passés`);
