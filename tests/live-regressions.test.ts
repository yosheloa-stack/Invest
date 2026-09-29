import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { SignalEvents } from "../web/signal-events.ts";
import { signalBlocked } from "../src/signal-gate.js";
import { liveCandle } from "../src/live-candle.js";
import { buildSeries, backtest } from "../src/strategies.js";
import { StrategyLab } from "../src/lab.js";
import { RestClient } from "../src/market.js";
import type { Signal, MarketState, Candle } from "../src/types.js";
const now = 1800000000000;
const signal = (patch = {}) =>
  ({
    id: "one",
    symbol: "BTCUSDT",
    t: now,
    expires: now + 30000,
    status: "PENDING",
    horizon: 5,
    modelId: "estrategia:test",
    ...patch,
  }) as Signal;
test("notifications deduplicate snapshots, catch skipped pending and notify result once", () => {
  const e = new SignalEvents();
  assert.equal(e.consume([], now, true).length, 0);
  assert.equal(e.consume([signal(), signal()], now, true).length, 1);
  assert.equal(e.consume([signal()], now + 1000, true).length, 0);
  assert.equal(
    e.consume(
      [signal({ status: "FILLED", entryAt: now + 1000 })],
      now + 1000,
      true,
    ).length,
    0,
  );
  const result = signal({
    status: "SETTLED",
    result: "WIN",
    exitAt: now + 300000,
  });
  assert.equal(e.consume([result], now + 300000, false).length, 0);
  assert.equal(e.consume([result], now + 300000, true)[0].kind, "result");
  assert.equal(e.consume([result], now + 301000, true).length, 0);
  assert.equal(
    e.consume(
      [signal({ id: "two", status: "FILLED", entryAt: now + 301000 })],
      now + 302000,
      true,
    )[0].kind,
    "filled",
  );
});
test("initial history and expired entries never trigger old entry alerts", () => {
  const e = new SignalEvents();
  assert.deepEqual(
    e.consume(
      [
        signal({ expires: now - 1 }),
        signal({ id: "old", status: "SETTLED", exitAt: now }),
      ],
      now,
      true,
    ),
    [],
  );
});
test("per-asset gate blocks duplicate horizons, keeps other assets independent and restores cooldown", () => {
  assert.equal(
    signalBlocked("BTCUSDT", now, 300000, new Map(), [signal({ horizon: 15 })]),
    true,
  );
  assert.equal(
    signalBlocked("ETHUSDT", now, 300000, new Map(), [signal()]),
    false,
  );
  const restored = new Map([["BTCUSDT:10", now - 1000]]);
  assert.equal(signalBlocked("BTCUSDT", now, 300000, restored, []), true);
  assert.equal(
    signalBlocked("BTCUSDT", now + 300000, 300000, restored, []),
    false,
  );
});
test("forming candle preserves exchange open before connection and extends only newer trades", () => {
  const t = Math.floor(now / 60000) * 60000;
  const state = {
    connected: true,
    trade: { t: t + 3000 },
    formingAt: t + 2000,
    forming: {
      t,
      end: t + 59999,
      o: 90,
      h: 105,
      l: 89,
      c: 100,
      v: 10,
      buy: 4,
      quote: 1000,
    },
    trades: [
      { t: t + 1000, p: 100, q: 1, buy: true },
      { t: t + 3000, p: 108, q: 2, buy: true },
    ],
  } as MarketState;
  const c = liveCandle(state)!;
  assert.equal(c.o, 90);
  assert.equal(c.h, 108);
  assert.equal(c.c, 108);
  assert.equal(c.v, 12);
  assert.equal(liveCandle({ ...state, connected: false }), null);
});
const cs: Candle[] = Array.from({ length: 1000 }, (_, i) => ({
  t: i * 60000,
  end: i * 60000 + 59999,
  o: 100,
  h: 101,
  l: 99,
  c: 100 + i * 0.00001,
  v: 10,
  buy: 5,
  quote: 1000,
}));
test("backtest neutral threshold prevents microscopic moves being counted as wins", () => {
  const s = buildSeries(cs),
    spec = { id: "x", family: "x", label: "x", signal: () => 1 as const };
  const r = backtest(s, spec, 5, 300, 1000, 5, 1.96, undefined, 0.0005);
  assert.equal(r.all.wins, 0);
  assert.equal(r.all.losses, 0);
  assert.ok(r.all.ties > 0);
});
test("stale, failed or cross-exchange research cannot authorize live signals", () => {
  const lab = new StrategyLab(new RestClient());
  lab.evaluations = [{ approved: true, symbol: "BTCUSDT", horizon: 5 } as any];
  lab.updatedAt = Date.now();
  lab.sources.BTCUSDT = "Bybit";
  assert.equal(lab.approved("BTCUSDT", 5).length, 0);
  lab.sources.BTCUSDT = "Binance";
  assert.equal(lab.approved("BTCUSDT", 5).length, 1);
  lab.error = "failed";
  assert.equal(lab.summary().approved, 0);
  assert.equal(lab.approved("BTCUSDT", 5).length, 0);
  lab.error = null;
  lab.updatedAt = 1;
  assert.equal(lab.approved("BTCUSDT", 5).length, 0);
});
test("production worker completes real strategy code without blocking main-loop timers", async () => {
  let heartbeats = 0;
  const timer = setInterval(() => heartbeats++, 1);
  const worker = new Worker(new URL("../dist/lab-worker.js", import.meta.url), {
    workerData: {
      symbol: "TESTUSDT",
      candles: cs,
      horizons: [5, 10, 15],
      options: {
        breakEven: 1 / 1.8,
        cooldownBars: 5,
        minTrades: 100,
        z: 1.96,
        inSampleShare: 0.6,
        returnThreshold: 0.0005,
      },
    },
  });
  try {
    const [result] = await once(worker, "message");
    assert.ok(Array.isArray(result));
    assert.ok(heartbeats > 0);
  } finally {
    clearInterval(timer);
    await worker.terminate();
  }
});
