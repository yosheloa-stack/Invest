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
