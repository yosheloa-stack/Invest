import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSeries, catalog } from "../src/strategies.js";
import { priceContext, contextAllows } from "../src/price-context.js";
import { contraryContext } from "../src/signals.js";
import { liveCandle } from "../src/live-candle.js";
import { pair } from "../web/format.ts";
import type { Candle, MarketState, Features } from "../src/types.js";
function fixture() {
  const cs: Candle[] = Array.from({ length: 100 }, (_, i) => ({
    t: i * 60000,
    end: i * 60000 + 59999,
    o: 100,
    h: 101,
    l: 99,
    c: 100,
    v: 10,
    buy: 5,
    quote: 1000,
  }));
  const s = buildSeries(cs);
  s.atr.fill(1);
  s.ema9.fill(100);
  s.ema21.fill(100);
  s.ema50.fill(100);
  return s;
}
test("EUR/USDT keeps its true quote asset, never masquerades as Forex", () => {
  assert.equal(pair("EURUSDT"), "EUR/USDT");
});
test("fresh exchange candle advances even without a new trade and never reuses the previous minute", () => {
  const forming = {
    t: 120000,
    end: 179999,
    o: 100,
    h: 101,
    l: 99,
    c: 100,
    v: 0,
    buy: 0,
    quote: 0,
  };
  const s = {
    connected: true,
    forming,
    formingAt: 122000,
    trade: { t: 119000 },
    trades: [{ t: 119000, p: 500, q: 3, buy: true }],
  } as MarketState;
  assert.deepEqual(liveCandle(s), forming);
  assert.deepEqual(liveCandle({ ...s, trade: undefined }), forming);
});
test("all strategy families reject buying against a confirmed downtrend", () => {
  const s = fixture(),
    i = 90;
  s.ema9[i] = 95;
  s.ema21[i] = 97;
  s.ema50[i] = 99;
  s.rsi7[i] = 10;
  s.rsi14[i] = 10;
  s.o[i] = 97;
  s.c[i] = 96;
  s.h[i] = 98;
  s.l[i] = 95;
  assert.equal(priceContext(s, i).trend, -1);
  assert.equal(contextAllows(s, i, 1), false);
  for (const spec of catalog()) assert.notEqual(spec.signal(s, i), 1, spec.id);
});
test("lateral strategy requires repeated confirmed edges and rejects the middle", () => {
  const s = fixture(),
    i = 90;
  for (const j of [20, 40, 60, 80]) s.l[j] = 98;
  for (const j of [30, 50, 70]) s.h[j] = 102;
  assert.equal(priceContext(s, i).range, true);
  assert.equal(contextAllows(s, i, 1), false);
  const edge = fixture();
  for (const j of [20, 40, 60, 80]) edge.l[j] = 98;
  for (const j of [30, 50, 70]) edge.h[j] = 102;
  edge.l[i] = 98.1;
  edge.o[i] = 98.5;
  edge.c[i] = 99.5;
  const spec = catalog().find((x) => x.family === "lateral")!;
  assert.equal(spec.signal(edge, i), 1);
});
test("LTA requires rising confirmed pivots, valid line and a rejecting candle", () => {
  const s = fixture(),
    i = 90;
  s.atr.fill(2);
  s.l[60] = 90;
  s.l[80] = 94;
  s.l[i] = 96;
  s.o[i] = 98;
  s.c[i] = 100;
  s.ema9[i] = 100;
  s.ema21[i] = 99;
  s.ema50[i] = 98;
  s.ema50[i - 10] = 97;
  assert.equal(priceContext(s, i).lta, 96);
  assert.equal(
    catalog()
      .find((x) => x.family === "estrutura")!
      .signal(s, i),
    1,
  );
});
test("Fibonacci requires ordered confirmed impulse, zone touch and closing confirmation", () => {
  const s = fixture(),
    i = 90;
  s.l[68] = 90;
  s.h[78] = 110;
  s.atr.fill(2);
  s.ema9[i] = 105;
  s.ema21[i] = 104;
  s.ema50[i] = 103;
  s.ema50[i - 10] = 101;
  s.l[i] = 101;
  s.o[i] = 102;
  s.c[i] = 104;
  s.h[i] = 104.2;
  const f = priceContext(s, i).fib!;
  assert.equal(f.direction, 1);
  assert.ok(Math.abs(f.low - 97.64) < 1e-8);
  assert.ok(Math.abs(f.high - 102.36) < 1e-8);
  assert.equal(
    catalog()
      .find((x) => x.family === "fibonacci")!
      .signal(s, i),
    1,
  );
});
test("future bars cannot repaint historical context or strategy triggers", () => {
  const a = fixture(),
    b = fixture(),
    i = 90;
  for (let j = 91; j < 100; j++) {
    b.c[j] = 10000;
    b.h[j] = 20000;
    b.l[j] = 1;
  }
  assert.deepEqual(priceContext(a, i), priceContext(b, i));
  for (const spec of catalog())
    assert.equal(spec.signal(a, i), spec.signal(b, i), spec.id);
});
test("live strategy/model gates reject contrary local and higher-timeframe trends", () => {
  assert.equal(
    contraryContext(
      {
        groups: { trend: -1, mtf: 0 },
        details: { micro: 0, macro: 0 },
      } as unknown as Features,
      1,
    ),
    true,
  );
  assert.equal(
    contraryContext(
      {
        groups: { trend: 1, mtf: 0 },
        details: { micro: 1, macro: -1 },
      } as unknown as Features,
      1,
    ),
    true,
  );
  assert.equal(
    contraryContext(
      {
        groups: { trend: 1, mtf: 0 },
        details: { micro: 1, macro: 0 },
      } as unknown as Features,
      1,
    ),
    false,
  );
});

test("LTB and bearish Fibonacci mirror their bullish setups", () => {
  const mirror = (s: ReturnType<typeof fixture>) => {
    const c = fixture();
    for (let j = 0; j < 100; j++) {
      c.o[j] = 200 - s.o[j];
      c.c[j] = 200 - s.c[j];
      c.h[j] = 200 - s.l[j];
      c.l[j] = 200 - s.h[j];
      c.ema9[j] = 200 - s.ema9[j];
      c.ema21[j] = 200 - s.ema21[j];
      c.ema50[j] = 200 - s.ema50[j];
      c.atr[j] = s.atr[j];
    }
    return c;
  };
  const s = fixture(),
    i = 90;
  s.atr.fill(2);
  s.l[60] = 90;
  s.l[80] = 94;
  s.l[i] = 96;
  s.o[i] = 98;
  s.c[i] = 100;
  s.ema9[i] = 100;
  s.ema21[i] = 99;
  s.ema50[i] = 98;
  s.ema50[i - 10] = 97;
  assert.equal(
    catalog()
      .find((x) => x.family === "estrutura")!
      .signal(mirror(s), i),
    -1,
  );
  const f = fixture();
  f.l[68] = 90;
  f.h[78] = 110;
  f.atr.fill(2);
  f.ema9[i] = 105;
  f.ema21[i] = 104;
  f.ema50[i] = 103;
  f.ema50[i - 10] = 101;
  f.l[i] = 101;
  f.o[i] = 102;
  f.c[i] = 104;
  f.h[i] = 104.2;
  assert.equal(
    catalog()
      .find((x) => x.family === "fibonacci")!
      .signal(mirror(f), i),
    -1,
  );
});
