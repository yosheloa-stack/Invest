import { test } from "node:test";
import assert from "node:assert/strict";
import { combine, fillGaps } from "../src/fx.js";
const bar = (t: number, c: number) => ({
  t,
  end: t + 59999,
  o: c,
  h: c,
  l: c,
  c,
  v: 1,
  buy: 0.5,
  quote: 0,
});
test("forex: gaps become flat candles at the previous close", () => {
  const out = fillGaps([bar(0, 1.1), bar(180000, 1.2)], 60000);
  assert.deepEqual(
    out.map((c) => [c.t, c.c]),
    [
      [0, 1.1],
      [60000, 1.1],
      [120000, 1.1],
      [180000, 1.2],
    ],
  );
});
test("forex: 1m bars combine into a higher timeframe", () => {
  const c = combine(
    [bar(0, 1), { ...bar(60000, 3), h: 4 }, bar(120000, 2)],
    0,
    300000,
  )!;
  assert.deepEqual([c.o, c.h, c.l, c.c, c.end], [1, 4, 1, 2, 299999]);
});
