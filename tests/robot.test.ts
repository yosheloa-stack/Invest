import { test } from "node:test";
import assert from "node:assert/strict";
import { catalog, type Evaluation } from "../src/strategies.js";
import {
  robotPerformance,
  readMarket,
  settleTrade,
  robotStats,
  newTrade,
  liveKey,
  losingSpot,
  moneyPlan,
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
  assert.match(bad.why, /mínimo/);
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
test("robot: higher-timeframe bias follows a steady trend", async () => {
  const { bias } = await import("../src/robot.js");
  const up = Array.from({ length: 1500 }, (_, i) => {
    const c = 100 + i * 0.05 + Math.sin(i / 7) * 0.2;
    return {
      t: i * 60000,
      end: i * 60000 + 59999,
      o: c - 0.02,
      h: c + 0.1,
      l: c - 0.1,
      c,
      v: 10,
      buy: 5,
      quote: 0,
    };
  });
  assert.equal(bias(up, 5), 1);
  assert.equal(
    bias(
      up.map((x) => ({
        ...x,
        o: 300 - x.o,
        h: 300 - x.l,
        l: 300 - x.h,
        c: 300 - x.c,
      })),
      5,
    ),
    -1,
  );
});
test("robotPerformance counts closed trades by asset and ignores open ones", () => {
  const base = {
    horizon: 5 as const,
    direction: "COMPRA" as const,
    strategyId: "x",
    strategy: "RSI",
    score: 0.6,
    backtestWinRate: 0.6,
    entry: 1,
    due: 0,
    stake: 10,
    payout: 0.9,
    reading: [],
    ai: null,
  };
  const t = (
    id: string,
    symbol: string,
    status: "ABERTA" | "FECHADA",
    result?: "WIN" | "LOSS" | "EMPATE",
    profit?: number,
  ) => ({
    ...base,
    id,
    symbol,
    status,
    result,
    profit,
    openedAt: 1000,
    closedAt: 2000 + Number(id),
  });
  const p = robotPerformance(
    [
      t("1", "BTCUSDT", "FECHADA", "WIN", 9),
      t("2", "BTCUSDT", "FECHADA", "LOSS", -10),
      t("3", "EURUSD", "FECHADA", "EMPATE", 0),
      t("4", "ETHUSDT", "ABERTA"),
    ],
    1 / 1.9,
  );
  assert.equal(p.count, 3);
  assert.equal(p.wins, 1);
  assert.equal(p.losses, 1);
  assert.equal(p.neutrals, 1);
  assert.equal(p.open, 1);
  assert.equal(p.profit, -1);
  assert.equal(p.byAsset.BTCUSDT.count, 2);
  assert.equal(p.byHorizon["5 min"].count, 3);
});
test("robot waits until enough strategy families agree", () => {
  const cs = firing();
  const r = readMarket("TESTUSDT", cs, evals(0.6), new Map(), opts)!;
  const families = new Set(
    r.fired
      .filter((f) => f.direction === r.pick!.direction)
      .map((f) => f.id.split(":")[0]),
  ).size;
  const strict = readMarket("TESTUSDT", cs, evals(0.6), new Map(), {
    ...opts,
    minAgree: families + 1,
  })!;
  assert.equal(strict.pick, null);
  assert.match(strict.why, /concordando/);
  const ok = readMarket("TESTUSDT", cs, evals(0.6), new Map(), {
    ...opts,
    minAgree: families,
  })!;
  assert.ok(ok.pick, ok.why);
});
test("robot stops on an asset where its own record loses", () => {
  const cs = firing();
  const r = readMarket("TESTUSDT", cs, evals(0.6), new Map(), opts)!;
  const base = {
    ...newTrade(r, r.pick!, 100, 0, 10, 0.9, null),
    direction: "COMPRA" as const,
  };
  const trades = Array.from({ length: 20 }, (_, k) =>
    settleTrade(
      { ...base, id: String(k), openedAt: k * 3600000 },
      k < 8 ? 101 : 99,
      0,
    ),
  );
  assert.match(
    losingSpot(trades, "TESTUSDT", 0, 1 / 1.9, 15) ?? "",
    /neste ativo/,
  );
  assert.equal(losingSpot(trades, "OTHER", 0, 1 / 1.9, 15), null);
  assert.equal(
    losingSpot(trades.slice(0, 10), "TESTUSDT", 0, 1 / 1.9, 15),
    null,
  );
});
test("gestão: Soros adds the last win's profit and resets after the cycle", () => {
  const cs = firing();
  const r = readMarket("TESTUSDT", cs, evals(0.6), new Map(), opts)!;
  const base = {
    ...newTrade(r, r.pick!, 100, 0, 10, 0.9, null),
    direction: "COMPRA" as const,
  };
  const day = Date.UTC(2026, 8, 30, 15);
  const closeAt = (k: number, exit: number, stake = 10) =>
    settleTrade(
      { ...base, id: String(k), stake, openedAt: day + k * 60000 },
      exit,
      day + k * 60000 + 300000,
    );
  const rules = {
    mode: "fixo" as const,
    value: 10,
    soros: 1,
    stopWin: 0,
    stopLoss: 0,
  };
  assert.equal(moneyPlan([], rules, 1000, day).stake, 10);
  const oneWin = [closeAt(1, 101)];
  assert.equal(moneyPlan(oneWin, rules, 1000, day).stake, 19);
  const twoWins = [closeAt(2, 101, 19), ...oneWin];
  assert.equal(moneyPlan(twoWins, rules, 1000, day).stake, 10);
  const loss = [closeAt(3, 99), ...oneWin];
  assert.equal(moneyPlan(loss, rules, 1000, day).stake, 10);
  const pct = moneyPlan([], { ...rules, mode: "percent", value: 2 }, 1000, day);
  assert.equal(pct.stake, 20);
  const stop = moneyPlan(
    [closeAt(4, 99), closeAt(5, 99), closeAt(6, 99)],
    { ...rules, stopLoss: 2 },
    1000,
    day,
  );
  assert.match(stop.stop ?? "", /Stop loss/);
});
