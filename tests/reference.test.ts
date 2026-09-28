import { test } from "node:test";
import assert from "node:assert/strict";
import ti from "technicalindicators";
import { technical, last } from "../src/indicators.js";
import type { Candle } from "../src/types.js";
const candles: Candle[] = Array.from({ length: 700 }, (_, i) => {
  const c = 100 + Math.sin(i / 7) * 4 + i * 0.003;
  return {
    t: i * 60000,
    end: (i + 1) * 60000 - 1,
    o: c - 0.2,
    h: c + 0.8,
    l: c - 0.9,
    c,
    v: 100 + (i % 7),
    buy: 50,
    quote: c * 100,
  };
});
const close = candles.map((c) => c.c),
  high = candles.map((c) => c.h),
  low = candles.map((c) => c.l),
  i = technical(candles);
const near = (a: number, b: number, tol = 1e-8) =>
  assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
test("EMA, ATR, MACD, DMI, ADX, bands and stochastic match independent reference", () => {
  near(i.ema9, last(ti.EMA.calculate({ period: 9, values: close })));
  near(i.ema21, last(ti.EMA.calculate({ period: 21, values: close })));
  near(i.ema50, last(ti.EMA.calculate({ period: 50, values: close })));
  near(i.ema200, last(ti.EMA.calculate({ period: 200, values: close })));
  near(i.atr, last(ti.ATR.calculate({ period: 14, high, low, close })));
  near(i.rsi, last(ti.RSI.calculate({ period: 14, values: close })), 0.011);
  const macd = last(
    ti.MACD.calculate({
      values: close,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    }),
  );
  near(i.macd, macd.MACD!);
  near(i.macdSignal, macd.signal!);
  near(i.macdHist, macd.histogram!);
  const adx = last(ti.ADX.calculate({ high, low, close, period: 14 }));
  near(i.adx, adx.adx);
  near(i.plusDI, adx.pdi);
  near(i.minusDI, adx.mdi);
  const bb = last(
    ti.BollingerBands.calculate({ period: 20, values: close, stdDev: 2 }),
  );
  near(i.bbUpper, bb.upper);
  near(i.bbLower, bb.lower);
  const st = last(
    ti.Stochastic.calculate({ high, low, close, period: 14, signalPeriod: 3 }),
  );
  near(i.stochK, st.k);
  near(i.stochD, st.d);
});
