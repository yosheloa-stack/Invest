import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSeries,
  catalog,
  backtest,
  evaluateSymbol,
  wilson,
} from "../src/strategies.js";
import type { Candle } from "../src/types.js";
// Synthetic fixtures ONLY for deterministic unit tests. Never imported by runtime.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
function walk(n: number, seed: number, revert = 0): Candle[] {
  const r = rng(seed),
    out: Candle[] = [];
  let p = 100,
    prev = 0;
  for (let i = 0; i < n; i++) {
    const g = (r() + r() + r() - 1.5) * 0.002,
      step = g - revert * prev,
      c = p * (1 + step),
      buy = r();
    out.push({
      t: i * 60000,
      end: i * 60000 + 59999,
      o: p,
      h: Math.max(p, c) * 1.0003,
      l: Math.min(p, c) * 0.9997,
      c,
      v: 10,
      buy: 10 * buy,
      quote: 10 * c,
    });
    prev = step;
    p = c;
  }
  return out;
}
const options = {
  breakEven: 1 / 1.8,
  cooldownBars: 5,
  minTrades: 100,
  z: 1.96,
  inSampleShare: 0.6,
};
test("wilson lower bound is below the observed rate and tightens with more data", () => {
  assert.ok(wilson(60, 100, 1.96)! < 0.6);
  assert.ok(wilson(600, 1000, 1.96)! > wilson(60, 100, 1.96)!);
  assert.equal(wilson(0, 0, 1.96), null);
});
test("random walk: no strategy is approved (no false edge)", () => {
  const s = buildSeries(walk(43200, 7));
  const ev = evaluateSymbol("TESTUSDT", s, [5, 10, 15], options);
  assert.ok(ev.length > 20);
  assert.equal(ev.filter((x) => x.approved).length, 0);
});
test("statistical evaluator detects planted mean reversion independently of context admission", () => {
  const s = buildSeries(walk(43200, 11, 0.6));
  // Raw impulse fixtures isolate the statistical evaluator. The production
  // catalog deliberately requires a confirmed context for reversal signals.
  const specs = [1, -1].map((d) => ({
    id: `raw:impulse:${d === 1 ? "seguir" : "reverter"}`,
    family: "raw-impulse",
    label: "test fixture",
    signal: (s: ReturnType<typeof buildSeries>, i: number) => {
      const r = s.c[i] / s.c[i - 3] - 1;
      return (
        Math.abs(r) > 1.5 * s.sigma[i] * Math.sqrt(3) ? Math.sign(r) * d : 0
      ) as -1 | 0 | 1;
    },
  }));
  const ev = evaluateSymbol("TESTUSDT", s, [5], options, specs).filter(
    (x) => x.approved,
  );
  assert.ok(ev.length > 0);
  assert.ok(ev.some((x) => x.id.endsWith(":reverter")));
  for (const e of ev) assert.ok(e.outOfSample.lower! > options.breakEven);
});
test("backtest never overlaps positions and respects cooldown", () => {
  const s = buildSeries(walk(5000, 3)),
    always = { id: "x", family: "x", label: "x", signal: () => 1 as const };
  const r = backtest(s, always, 5, 0, 5000, 5, 1.96);
  // warmup 300, one trade every 5 bars until n - h
  assert.equal(r.all.trades, Math.ceil((5000 - 5 - 300) / 5));
});
test("catalog ids are unique", () => {
  const ids = catalog().map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length);
});
