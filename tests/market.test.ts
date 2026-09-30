import { test } from "node:test";
import assert from "node:assert/strict";
import { MarketData } from "../src/market.js";

test("a late kline is skipped instead of dropping the socket", () => {
  const m = new MarketData(),
    s = m.states.get("BTCUSDT")!,
    now = m.rest.now();
  const kline = (E: number) => ({
    stream: "btcusdt@kline_1m",
    data: {
      e: "kline",
      E,
      k: {
        i: "1m",
        t: now - 30000,
        T: now + 29999,
        o: "1",
        h: "1",
        l: "1",
        c: "1",
        v: "1",
        x: false,
      },
    },
  });
  const handle = (msg: unknown) =>
    (m as unknown as { message: (s: unknown, msg: unknown) => void }).message(
      s,
      msg,
    );
  assert.doesNotThrow(() => handle(kline(now - 60000)));
  assert.equal(s.lastKline["1m"], undefined);
  assert.throws(() => handle(kline(now + 60000)));
});
test("a Yahoo symbol's 1m candle a minute behind is not flagged late, a crypto one is", async () => {
  const { feedReasons } = await import("../src/market.js");
  const now = 1_000_000 * 60000 + 80000;
  const bars = (ms: number) =>
    Array.from({ length: 300 }, (_, i) => {
      const t = Math.floor((now - 140000) / ms) * ms - (299 - i) * ms;
      return {
        t,
        end: t + ms - 1,
        o: 1,
        h: 1,
        l: 1,
        c: 1,
        v: 1,
        buy: 0.5,
        quote: 0,
      };
    });
  const state = (symbol: string) => ({
    symbol,
    connected: true,
    ready: true,
    error: null,
    connectedAt: 1,
    trade: { id: 1, t: now, p: 1, q: 0, buy: true, received: now },
    quote: { t: now, bid: 1, ask: 1 },
    book: { t: now, id: 1, bidQty: 1, askQty: 1, imbalance: 0, change: 0 },
    trades: [],
    candles: {
      "1m": bars(60000),
      "5m": bars(300000),
      "15m": bars(900000),
      "1h": bars(3600000),
    },
    lastKline: { "1m": now, "5m": now, "15m": now, "1h": now },
  });
  const late = (symbol: string) =>
    feedReasons(state(symbol) as never, now, true).includes(
      "CANDLES 1m ATRASADOS",
    );
  assert.equal(late("USDJPY"), false);
  assert.equal(late("BTCUSDT"), true);
});
