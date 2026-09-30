import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candlePatterns,
  chartPatterns,
  toM5,
  type Bar,
} from "../src/patterns.js";
import type { Candle } from "../src/types.js";
const bar = (i: number, o: number, h: number, l: number, c: number): Bar => ({
  t: i * 300000,
  o,
  h,
  l,
  c,
});
// A steady fall of 12 red candles, then the candle(s) under test.
function falling(extra: Bar[]): Bar[] {
  const out: Bar[] = [];
  let p = 110;
  for (let i = 0; i < 12; i++) {
    out.push(bar(i, p, p + 0.2, p - 1.2, p - 1));
    p -= 1;
  }
  return [...out, ...extra.map((b, k) => ({ ...b, t: (12 + k) * 300000 }))];
}
test("M5 candles only from complete 5-minute windows", () => {
  const cs: Candle[] = Array.from({ length: 12 }, (_, i) => ({
    t: i * 60000,
    end: i * 60000 + 59999,
    o: i,
    h: i + 1,
    l: i - 1,
    c: i + 0.5,
    v: 1,
    buy: 0.5,
    quote: 0,
  }));
  const m5 = toM5(cs);
  assert.equal(m5.length, 2);
  assert.deepEqual(m5[0], { t: 0, o: 0, h: 5, l: -1, c: 4.5 });
});
test("hammer after a fall is read as bullish reversal", () => {
  const hits = candlePatterns(falling([bar(0, 98, 98.3, 95, 98.2)]));
  const h = hits.find((x) => x.id === "martelo");
  assert.ok(h, JSON.stringify(hits.map((x) => x.id)));
  assert.equal(h!.bias, 1);
});
test("bullish engulfing after a fall", () => {
  const hits = candlePatterns(
    falling([bar(0, 98, 98.2, 96.8, 97), bar(1, 96.9, 98.6, 96.7, 98.4)]),
  );
  assert.ok(hits.some((x) => x.id === "engolfo-alta" && x.bias === 1));
});
test("double top gives a neckline, a target below and an invalidation above", () => {
  const ys = [
    100, 101, 102, 103, 104, 105, 104, 103, 102, 101, 102, 103, 104, 105, 104,
    103, 102.5, 102.2,
  ];
  const bars: Bar[] = [];
  for (let i = 0; i < 20; i++) bars.push(bar(i, 99, 99.5, 98.5, 99));
  ys.forEach((y, k) => bars.push(bar(20 + k, y - 0.3, y + 0.2, y - 0.5, y)));
  const hit = chartPatterns(bars).find((x) => x.id === "topo-duplo");
  assert.ok(hit);
  assert.equal(hit!.bias, -1);
  assert.ok(hit!.level! < 102 && hit!.level! > 100);
  assert.ok(hit!.target! < hit!.level!);
  assert.ok(hit!.invalid! >= 105);
  assert.equal(hit!.status, "formando");
});
test("ascending triangle: flat ceiling, rising lows, breakout above", () => {
  const bars: Bar[] = [];
  for (let i = 0; i < 20; i++) bars.push(bar(i, 99, 99.5, 98.5, 99));
  const path = [
    95, 97, 99, 100, 99, 97, 96, 97.5, 99, 100, 99, 98, 97, 98, 99, 100, 99,
    98.5, 98, 98.6, 99.3,
  ];
  path.forEach((y, k) => bars.push(bar(20 + k, y - 0.2, y + 0.1, y - 0.3, y)));
  const hits = chartPatterns(bars);
  const tri = hits.find((x) => x.id === "triangulo-ascendente");
  assert.ok(tri, JSON.stringify(hits.map((x) => x.id)));
  assert.equal(tri!.bias, 1);
  assert.ok(Math.abs(tri!.level! - 100.1) < 0.3);
});
