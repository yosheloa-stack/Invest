import type { Candle, Indicators } from "./types.js";
export const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
export const last = <T>(a: T[]) => a[a.length - 1];
export function smooth(a: number[], n: number, alpha = 2 / (n + 1)): number[] {
  const out = Array(a.length).fill(NaN);
  if (a.length < n) return out;
  out[n - 1] = mean(a.slice(0, n));
  for (let i = n; i < a.length; i++)
    out[i] = alpha * a[i] + (1 - alpha) * out[i - 1];
  return out;
}
export function technical(c: Candle[]): Indicators {
  if (c.length < 250) throw Error("HISTÓRICO INSUFICIENTE");
  const close = c.map((x) => x.c),
    e9 = smooth(close, 9),
    e21 = smooth(close, 21),
    e50 = smooth(close, 50),
    e200 = smooth(close, 200);
  const tr = c.map((x, i) =>
    i
      ? Math.max(
          x.h - x.l,
          Math.abs(x.h - c[i - 1].c),
          Math.abs(x.l - c[i - 1].c),
        )
      : x.h - x.l,
  );
  const atrSeries = smooth(tr.slice(1), 14, 1 / 14),
    atr = last(atrSeries);
  const delta = close.slice(1).map((x, i) => x - close[i]);
  const gains = last(
      smooth(
        delta.map((x) => Math.max(0, x)),
        14,
        1 / 14,
      ),
    ),
    loss = last(
      smooth(
        delta.map((x) => Math.max(0, -x)),
        14,
        1 / 14,
      ),
    );
  const rsi =
    loss === 0 ? (gains === 0 ? 50 : 100) : 100 - 100 / (1 + gains / loss);
  const fast = smooth(close, 12),
    slow = smooth(close, 26),
    macds = close.slice(25).map((_, i) => fast[i + 25] - slow[i + 25]),
    macd = last(macds),
    macdSignal = last(smooth(macds, 9));
  const pdm: number[] = [],
    mdm: number[] = [];
  for (let i = 1; i < c.length; i++) {
    const up = c[i].h - c[i - 1].h,
      down = c[i - 1].l - c[i].l;
    pdm.push(up > down && up > 0 ? up : 0);
    mdm.push(down > up && down > 0 ? down : 0);
  }
  const p = smooth(pdm, 14, 1 / 14),
    m = smooth(mdm, 14, 1 / 14),
    pi = p.map((x, i) => (atrSeries[i] ? (100 * x) / atrSeries[i] : 0)),
    mi = m.map((x, i) => (atrSeries[i] ? (100 * x) / atrSeries[i] : 0));
  const dx = pi
    .slice(13)
    .map((x, i) =>
      x + mi[i + 13] ? (100 * Math.abs(x - mi[i + 13])) / (x + mi[i + 13]) : 0,
    );
  const adx = last(smooth(dx, 14, 1 / 14));
  const recent = close.slice(-20),
    bbMiddle = mean(recent),
    std = Math.sqrt(mean(recent.map((x) => (x - bbMiddle) ** 2)));
  const day = Math.floor(last(c).t / 86400000);
  const session = c.filter((x) => Math.floor(x.t / 86400000) === day);
  const vol = session.reduce((s, x) => s + x.v, 0);
  const vwap = vol
    ? session.reduce((s, x) => s + ((x.h + x.l + x.c) / 3) * x.v, 0) / vol
    : last(close);
  const ks: number[] = [];
  for (let i = 13; i < c.length; i++) {
    const w = c.slice(i - 13, i + 1),
      lo = Math.min(...w.map((x) => x.l)),
      hi = Math.max(...w.map((x) => x.h));
    ks.push(hi === lo ? 50 : (100 * (c[i].c - lo)) / (hi - lo));
  }
  let upper = 0,
    lower = 0,
    st = 0,
    dir = 1;
  for (let i = 14; i < c.length; i++) {
    const a = atrSeries[i - 1],
      mid = (c[i].h + c[i].l) / 2,
      bu = mid + 3 * a,
      bl = mid - 3 * a;
    if (i === 14) {
      upper = bu;
      lower = bl;
      st = upper;
      dir = -1;
      continue;
    }
    const pu = upper,
      pl = lower;
    upper = bu < pu || c[i - 1].c > pu ? bu : pu;
    lower = bl > pl || c[i - 1].c < pl ? bl : pl;
    dir = st === pu ? (c[i].c > upper ? 1 : -1) : c[i].c < lower ? -1 : 1;
    st = dir === 1 ? lower : upper;
  }
  const result = {
    ema9: last(e9),
    ema21: last(e21),
    ema50: last(e50),
    ema200: last(e200),
    rsi,
    macd,
    macdSignal,
    macdHist: macd - macdSignal,
    adx,
    plusDI: last(pi),
    minusDI: last(mi),
    atr,
    vwap,
    bbUpper: bbMiddle + 2 * std,
    bbLower: bbMiddle - 2 * std,
    bbMiddle,
    bbWidth: (4 * std) / bbMiddle,
    stochK: last(ks),
    stochD: mean(ks.slice(-3)),
    supertrend: st,
    superDirection: dir,
  };
  if (Object.values(result).some((x) => !Number.isFinite(x)))
    throw Error("INDICADOR NÃO INICIALIZADO");
  return result;
}
export function structure(c: Candle[]) {
  const highs: { p: number; t: number }[] = [],
    lows: { p: number; t: number }[] = [];
  // A pivot only becomes available after two closed candles to its right.
  for (let i = 2; i < c.length - 2; i++) {
    const w = c.slice(i - 2, i + 3);
    if (w.every((x) => x.h <= c[i].h))
      highs.push({ p: c[i].h, t: c[i + 2].end });
    if (w.every((x) => x.l >= c[i].l))
      lows.push({ p: c[i].l, t: c[i + 2].end });
  }
  const now = last(c),
    prev = c[c.length - 2],
    range = c.slice(-21, -1),
    resistance = Math.max(...range.map((x) => x.h)),
    support = Math.min(...range.map((x) => x.l));
  const hh = highs.length > 1 && last(highs).p > highs[highs.length - 2].p,
    hl = lows.length > 1 && last(lows).p > lows[lows.length - 2].p;
  const lh = highs.length > 1 && last(highs).p < highs[highs.length - 2].p,
    ll = lows.length > 1 && last(lows).p < lows[lows.length - 2].p;
  const breakout = now.c > resistance ? 1 : now.c < support ? -1 : 0;
  const falseBreakout =
    now.h > resistance && now.c < resistance
      ? -1
      : now.l < support && now.c > support
        ? 1
        : 0;
  const body = Math.abs(now.c - now.o),
    span = now.h - now.l;
  const rejection =
    span > 0
      ? (Math.min(now.o, now.c) - now.l - (now.h - Math.max(now.o, now.c))) /
        span
      : 0;
  const oldRange = c.slice(-22, -2),
    oldHigh = Math.max(...oldRange.map((x) => x.h)),
    oldLow = Math.min(...oldRange.map((x) => x.l));
  const retest =
    prev.c > oldHigh && now.l <= oldHigh && now.c > oldHigh
      ? 1
      : prev.c < oldLow && now.h >= oldLow && now.c < oldLow
        ? -1
        : 0;
  return {
    support,
    resistance,
    hh,
    hl,
    lh,
    ll,
    breakout,
    falseBreakout,
    retest,
    rejection,
    doji: span > 0 && body / span < 0.1,
    engulfing:
      now.o <= prev.c && now.c >= prev.o && now.c > now.o && prev.c < prev.o
        ? 1
        : now.o >= prev.c && now.c <= prev.o && now.c < now.o && prev.c > prev.o
          ? -1
          : 0,
    structure: hh && hl ? 1 : lh && ll ? -1 : 0,
  };
}
