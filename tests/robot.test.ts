import { test } from "node:test";
import assert from "node:assert/strict";
import { catalog, type Evaluation } from "../src/strategies.js";
import {
  readMarket,
  settleTrade,
  robotStats,
  newTrade,
  liveKey,
} from "../src/robot.js";
import type { Candle } from "../src/types.js";
function trendUp(n: number): Candle[] {
  const out: Candle[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    const c = p * (1 + 0.0006 + (i % 7 === 0 ? -0.0004 : 0));
    out.push({
      t: i * 60000,
      end: i * 60000 + 59999,
      o: p,
      h: Math.max(p, c) * 1.0002,
      l: Math.min(p, c) * 0.9998,
      c,
      v: 10,
      buy: 6,
      quote: 10 * c,
    });
    p = c;
  }
  return out;
}
const tally = (wins: number, losses: number) => ({
  trades: wins + losses,
  wins,
  losses,
  ties: 0,
  winRate: wins / (wins + losses),
  lower: null,
});
function evals(winRate: number, trades = 200): Evaluation[] {
  const w = Math.round(winRate * trades);
  return catalog().map((s) => ({
    symbol: "TESTUSDT",
    horizon: 5,
    id: s.id,
    family: s.family,
    label: s.label,
    inSample: tally(w, trades - w),
    outOfSample: tally(w, trades - w),
    halves: [tally(w, trades - w), tally(w, trades - w)],
    approved: false,
    reason: "",
  }));
}
const opts = { breakEven: 1 / 1.8, minTrades: 30, minScore: 1 / 1.8 };
// Find a candle count where some catalog strategy fires on the last candle.
function firing() {
  const all = trendUp(900);
  for (let n = 500; n <= 900; n++) {
    const r = readMarket(
      "TESTUSDT",
      all.slice(0, n),
      evals(0.6),
      new Map(),
      opts,
    );
    if (r?.fired.length) return all.slice(0, n);
  }
  throw Error("no trigger fired on fixture");
}
test("robot needs enough candles", () => {
  assert.equal(readMarket("X", trendUp(100), [], new Map(), opts), null);
});
test("robot only picks triggers whose history beats break-even", () => {
  const cs = firing();
  const good = readMarket("TESTUSDT", cs, evals(0.6), new Map(), opts)!;
  assert.ok(good.pick, good.why);
  assert.ok(good.pick!.score >= opts.minScore);
  const bad = readMarket("TESTUSDT", cs, evals(0.5), new Map(), opts)!;
  assert.equal(bad.pick, null);
  assert.match(bad.why, /equilíbrio/);
  assert.equal(good.trend, "ALTA");
});
test("robot's own losses pause a strategy", () => {
  const cs = firing();
  const r = readMarket("TESTUSDT", cs, evals(0.6), new Map(), opts)!;
  const live = new Map(
    r.fired.map((f) => [
      liveKey(f.id, "TESTUSDT", f.horizon),
      { wins: 2, trades: 12 },
    ]),
  );
  const after = readMarket("TESTUSDT", cs, evals(0.6), live, opts)!;
  assert.ok(after.fired.every((f) => f.paused));
  assert.equal(after.pick, null);
});
test("binary settlement and stats", () => {
  const cs = firing();
  const r = readMarket("TESTUSDT", cs, evals(0.6), new Map(), opts)!;
  const t = {
    ...newTrade(r, r.pick!, 100, 0, 10, 0.8, null),
    direction: "COMPRA" as const,
  };
  const win = settleTrade(t, 101, 300000),
    loss = settleTrade(t, 99, 300000),
    tie = settleTrade(t, 100, 300000);
  assert.equal(win.result, "WIN");
  assert.equal(win.profit, 8);
  assert.equal(loss.profit, -10);
  assert.equal(tie.result, "EMPATE");
  const s = robotStats(
    [win, loss, { ...win, id: "b", closedAt: 400000 }, tie],
    1000,
  );
  assert.equal(s.trades, 4);
  assert.equal(s.wins, 2);
  assert.equal(s.balance, 1006);
  assert.equal(s.winRate, 2 / 3);
});
