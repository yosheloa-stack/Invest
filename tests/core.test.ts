import { test } from "node:test";
import assert from "node:assert/strict";
import { technical, structure, smooth } from "../src/indicators.js";
import {
  putCandle,
  contiguous,
  feedReasons,
  freezeMarketState,
} from "../src/market.js";
import {
  buildFeatures,
  FEATURE_NAMES,
  FEATURE_VERSION,
} from "../src/features.js";
import { evaluate, advanceSignal } from "../src/signals.js";
import { predict, type ModelRegistry, type Model } from "../src/models.js";
import {
  classificationSchema,
  similarity,
  isDuplicate,
  NewsIntelligenceEngine,
} from "../src/news.js";
import type { Candle, MarketState, Signal, NewsEvent } from "../src/types.js";
// Synthetic fixtures ONLY for deterministic unit tests. Never imported by runtime.
function candles(n = 600, step = 0, start = 0): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + i * step;
    return {
      t: start + i * 60000,
      end: start + (i + 1) * 60000 - 1,
      o: c,
      h: c + 1,
      l: c - 1,
      c,
      v: 10,
      buy: 6,
      quote: c * 10,
    };
  });
}
function market(): MarketState {
  const now = 600 * 60000 + 1000;
  return {
    symbol: "BTCUSDT",
    connected: true,
    ready: true,
    error: null,
    connectedAt: 1,
    trade: { id: 1, t: now, p: 160, q: 1, buy: true, received: now },
    quote: { t: now, bid: 159.99, ask: 160.01 },
    book: { t: now, id: 1, bidQty: 12, askQty: 8, imbalance: 0.2, change: 0 },
    trades: [{ id: 1, t: now, p: 160, q: 1, buy: true, received: now }],
    candles: {
      "1m": candles(600, 0.1),
      "5m": candles(600, 0.1),
      "15m": candles(600, 0.1),
      "1h": candles(600, 0.1),
    },
    lastKline: { "1m": now, "5m": now, "15m": now, "1h": now },
  };
}
const context = { direction: 0, ids: [], important: false, reaction: 0 };
const f = buildFeatures(market(), 5, 600 * 60000 + 1000, context, false);
const signal: Signal = {
  id: "test-only",
  symbol: "BTCUSDT",
  t: 1000,
  horizon: 5,
  direction: "COMPRA",
  analyzedPrice: 100,
  entryLow: 99.9,
  entryHigh: 100.1,
  expires: 31000,
  probability: 0.7,
  modelId: "fixture-only",
  features: f,
  score: 1,
  favorable: [],
  contrary: [],
  status: "PENDING",
};
test("flat candles initialize every requested indicator without NaN", () => {
  const i = technical(candles());
  assert.equal(i.rsi, 50);
  assert.equal(i.atr, 2);
  assert.equal(i.adx, 0);
  assert.equal(i.macd, 0);
  assert.equal(i.macdSignal, 0);
  assert.equal(i.vwap, 100);
  assert.equal(i.bbUpper, 100);
  assert.equal(i.bbLower, 100);
  assert.equal(i.stochK, 50);
  assert.equal(i.stochD, 50);
  for (const k of ["ema9", "ema21", "ema50", "ema200"] as const)
    assert.ok(Math.abs(i[k] - 100) < 1e-10);
  assert.ok(Object.values(i).every(Number.isFinite));
});
test("monotonic prices produce RSI 100, +DI and ADX 100", () => {
  const i = technical(candles(600, 0.1));
  assert.equal(i.rsi, 100);
  assert.ok(Math.abs(i.adx - 100) < 1e-10);
  assert.ok(i.plusDI > 0);
  assert.equal(i.minusDI, 0);
  assert.equal(i.superDirection, 1);
  assert.ok(i.ema9 > i.ema21 && i.ema21 > i.ema50 && i.ema50 > i.ema200);
});
test("EMA uses SMA seed and fails warmup explicitly", () => {
  assert.equal(smooth([1, 2, 3, 4], 3)[2], 2);
  assert.equal(smooth([1, 2, 3, 4], 3)[3], 3);
  assert.throws(() => technical(candles(200)));
});
test("pivots cannot use two unclosed future confirmation candles", () => {
  const c = candles(30);
  c[28].h = 500;
  assert.equal(structure(c).hh, false);
});
test("upserts deduplicate and detect candle gaps", () => {
  const c = candles(300);
  assert.equal(putCandle(c, c[10]).length, 300);
  assert.equal(contiguous(c, 60000), true);
  assert.equal(
    contiguous(
      c.filter((_, i) => i !== 10),
      60000,
    ),
    false,
  );
});
test("feature vectors are finite, named and distinct by horizon", () => {
  const s = market(),
    a = buildFeatures(s, 5, f.t, context, false),
    b = buildFeatures(s, 10, f.t, context, false),
    c = buildFeatures(s, 15, f.t, context, false);
  assert.deepEqual(a.names, FEATURE_NAMES);
  assert.equal(a.vector.length, FEATURE_NAMES.length);
  assert.notDeepEqual(a.vector, b.vector);
  assert.notDeepEqual(b.vector, c.vector);
  assert.ok(a.vector.every(Number.isFinite));
});
test("appending future candles does not affect features at earlier timestamp", () => {
  const s = market(),
    a = buildFeatures(s, 5, f.t, context, false);
  s.candles["1m"].push({
    t: f.t + 100,
    end: f.t + 60000,
    o: 1,
    h: 100000,
    l: 1,
    c: 90000,
    v: 100,
    buy: 50,
    quote: 1,
  });
  const b = buildFeatures(s, 5, f.t, context, false);
  assert.deepEqual(a, b);
});
test("feed guard blocks disconnect, stale data, clock uncertainty and gaps", () => {
  const s = market();
  s.connected = false;
  s.ready = false;
  s.error = "PRIMARY ERROR";
  s.candles["1m"].splice(10, 1);
  const r = feedReasons(s, f.t + 10000, false).join(" ");
  for (const expected of [
    "DESCONECTADO",
    "NÃO CARREGADO",
    "RELÓGIO",
    "TRADES ATRASADOS",
    "BID/ASK",
    "LIVRO",
    "GAP",
    "PRIMARY ERROR",
  ])
    assert.ok(r.includes(expected));
});
test("no model means no probability and no signal", () => {
  const registry = {
    get() {
      throw Error("MODELO NÃO CARREGADO");
    },
  } as unknown as ModelRegistry;
  const d = evaluate(f, registry, false, false);
  assert.equal(d.state, "ANÁLISE INDISPONÍVEL");
  assert.equal(d.probability, null);
  assert.equal(d.signal, undefined);
});
test("softmax output sums to 1 and out-of-distribution features are rejected", () => {
  const n = FEATURE_NAMES.length,
    m = {
      mean: Array(n).fill(0),
      scale: Array(n).fill(100),
      coef: [Array(n).fill(0), Array(n).fill(0), Array(n).fill(0)],
      intercept: [0, 0, 0],
      temperature: 1,
    } as Model;
  assert.deepEqual(predict(m, f), [1 / 3, 1 / 3, 1 / 3]);
  assert.throws(() => predict({ ...m, scale: Array(n).fill(0.00001) }, f));
});
test("SNIPER fails closed if news source is not ready", () => {
  const n = FEATURE_NAMES.length,
    m = {
      id: "fixture",
      mean: f.vector,
      scale: Array(n).fill(1),
      coef: [Array(n).fill(0), Array(n).fill(0), Array(n).fill(0)],
      intercept: [-3, -3, 3],
      temperature: 1,
    } as Model;
  const d = evaluate(
    f,
    {
      get() {
        return m;
      },
    } as unknown as ModelRegistry,
    false,
    true,
  );
  assert.equal(d.state, "ANÁLISE INDISPONÍVEL");
  assert.match(d.reason, /NOTÍCIAS/);
});
test("paper never fills using a quote before signal time", () => {
  assert.equal(
    advanceSignal(signal, { t: 900, bid: 100, ask: 100 }, 1100, true).status,
    "PENDING",
  );
});
test("paper invalidates outside entry range and disconnected feed", () => {
  assert.equal(
    advanceSignal(signal, { t: 1100, bid: 110, ask: 111 }, 1200, true).status,
    "INVALIDATED",
  );
  assert.equal(
    advanceSignal(signal, undefined, 1200, false).status,
    "INVALIDATED",
  );
});
test("paper expires and uses ask entry, bid exit, horizon measured from fill", () => {
  assert.equal(
    advanceSignal(signal, { t: 32000, bid: 100, ask: 100.01 }, 32000, true)
      .status,
    "EXPIRED",
  );
  const filled = advanceSignal(
    signal,
    { t: 1100, bid: 99.99, ask: 100.01 },
    1200,
    true,
  );
  assert.equal(filled.entry, 100.01);
  assert.equal(filled.due, 301100);
  const end = advanceSignal(
    filled,
    { t: 301100, bid: 101, ask: 101.1 },
    301200,
    true,
  );
  assert.equal(end.exit, 101);
  assert.equal(end.result, "WIN");
});
test("missing maturity quote cannot be scored using a later price", () => {
  const filled = advanceSignal(
    signal,
    { t: 1100, bid: 100, ask: 100.01 },
    1200,
    true,
  );
  const end = advanceSignal(
    filled,
    { t: 305000, bid: 110, ask: 111 },
    305000,
    true,
  );
  assert.equal(end.status, "NO_DATA");
  assert.equal(end.result, undefined);
});
test("SELL paper enters bid and exits ask", () => {
  const filled = advanceSignal(
    { ...signal, direction: "VENDA" },
    { t: 1100, bid: 100, ask: 100.01 },
    1200,
    true,
  );
  const end = advanceSignal(
    filled,
    { t: 301100, bid: 99, ask: 99.1 },
    301200,
    true,
  );
  assert.equal(filled.entry, 100);
  assert.equal(end.exit, 99.1);
  assert.equal(end.result, "WIN");
});
test("news dedup uses same event, entities, time and optional embeddings", () => {
  const n: NewsEvent = {
    id: "a",
    title: "Bitcoin ETF approval by SEC",
    content: "SEC approves Bitcoin ETF today",
    source: "A",
    url: "https://example.com/a",
    publishedAt: 1000,
    receivedAt: 1000,
    availableAt: null,
    classification: null,
    embedding: [1, 0],
    fingerprint: "a",
  };
  assert.equal(
    isDuplicate(n, {
      ...n,
      id: "b",
      source: "B",
      url: "https://example.com/b",
    }),
    true,
  );
  assert.equal(isDuplicate(n, { ...n, publishedAt: 86400000 }), false);
  assert.equal(similarity("Bitcoin ETF", "Bitcoin ETF"), 1);
  assert.equal(
    isDuplicate(n, {
      ...n,
      title: "Bitcoin fund cleared",
      content: "New fund announcement",
      fingerprint: "c",
      url: "https://example.com/c",
      embedding: [0.99, 0.01],
    }),
    true,
  );
});
test("news classifier schema rejects fabricated confidence outside range", () => {
  assert.equal(
    classificationSchema.safeParse({
      assets: ["BTC"],
      sentiment: "positive",
      impact_score: 8,
      relevance: 0.8,
      confidence: 92,
      expected_horizon: "short_term",
      event_type: "etf",
      summary: "test",
      reasoning_summary: "test",
    }).success,
    false,
  );
});

test("frozen market observations cannot absorb asynchronous live updates", () => {
  const live = market(),
    frozen = freezeMarketState(live),
    before = buildFeatures(frozen, 5, f.t, context, false);
  live.trade!.p = 900000;
  live.candles["1m"].push({ ...live.candles["1m"][0], c: 400000 });
  live.trades.push({ ...live.trades[0], p: 100000, q: 999 });
  assert.deepEqual(buildFeatures(frozen, 5, f.t, context, false), before);
});
test("a future trade cannot be assigned to an earlier feature timestamp", () => {
  const s = market();
  s.trade!.t = f.t + 1;
  assert.throws(() => buildFeatures(s, 5, f.t, context, false), /POSTERIORES/);
});

test("news availability and reaction gates are point-in-time and event-specific", () => {
  const engine = new NewsIntelligenceEngine({} as never);
  const n: NewsEvent = {
    id: "new",
    title: "test",
    content: "fixture",
    source: "test",
    url: "https://example.com",
    publishedAt: 1000,
    receivedAt: 1000,
    availableAt: 2000,
    embedding: null,
    fingerprint: "a",
    classification: {
      assets: ["BTC"],
      sentiment: "positive",
      impact_score: 9,
      relevance: 1,
      confidence: 0.99,
      expected_horizon: "short_term",
      event_type: "etf",
      summary: "fixture",
      reasoning_summary: "fixture",
    },
  };
  engine.events = [n];
  engine.reactionCache.BTCUSDT = { asOf: 1000, perNews: { unrelated: 0.02 } };
  assert.deepEqual(engine.context("BTCUSDT", 1500).ids, []);
  assert.equal(engine.context("BTCUSDT", 3000).reaction, 0);
  engine.reactionCache.BTCUSDT = { asOf: 2500, perNews: { new: 0.01 } };
  assert.equal(engine.context("BTCUSDT", 2400).reaction, 0);
  assert.equal(engine.context("BTCUSDT", 3000).reaction, 1);
});
