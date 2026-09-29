import type { Series, StrategySpec } from "./strategies.js";
export type Direction = -1 | 0 | 1;
type Pivot = { i: number; p: number };
export type PriceContext = {
  trend: Direction;
  range: boolean;
  support: number;
  resistance: number;
  lta: number | null;
  ltb: number | null;
  fib: { direction: Direction; low: number; high: number } | null;
};
const cache = new WeakMap<Series, Map<number, PriceContext>>();
// Only pivots confirmed by TWO candles on the right, all at or before i.
// The same causal rules are used by research, chart triggers and live decisions.
export function priceContext(s: Series, i: number): PriceContext {
  let memo = cache.get(s);
  if (!memo) {
    memo = new Map();
    cache.set(s, memo);
  }
  const saved = memo.get(i);
  if (saved) return saved;
  const empty: PriceContext = {
    trend: 0,
    range: false,
    support: NaN,
    resistance: NaN,
    lta: null,
    ltb: null,
    fib: null,
  };
  const atr = s.atr[i];
  if (i < 80 || !Number.isFinite(atr) || atr <= 0) return empty;
  const lows: Pivot[] = [],
    highs: Pivot[] = [];
  const start = i - 79;
  let support = Infinity,
    resistance = -Infinity;
  for (let j = start; j < i; j++) {
    support = Math.min(support, s.l[j]);
    resistance = Math.max(resistance, s.h[j]);
    if (j < start + 2 || j > i - 2) continue;
    if ([j - 2, j - 1, j + 1, j + 2].every((k) => s.l[j] < s.l[k]))
      lows.push({ i: j, p: s.l[j] });
    if ([j - 2, j - 1, j + 1, j + 2].every((k) => s.h[j] > s.h[k]))
      highs.push({ i: j, p: s.h[j] });
  }
  const slope = (s.ema50[i] - s.ema50[i - 10]) / atr;
  const trend: Direction =
    s.ema9[i] > s.ema21[i] && s.ema21[i] > s.ema50[i] && slope > 0.1
      ? 1
      : s.ema9[i] < s.ema21[i] && s.ema21[i] < s.ema50[i] && slope < -0.1
        ? -1
        : 0;
  const touches = (pivots: Pivot[], level: number) =>
    pivots.filter((p) => Math.abs(p.p - level) <= atr * 0.35).length;
  const range =
    trend === 0 &&
    Math.abs(slope) < 0.4 &&
    Math.abs(s.ema21[i] - s.ema50[i]) < atr * 0.8 &&
    resistance - support >= atr * 2 &&
    resistance - support <= atr * 8 &&
    touches(lows, support) >= 2 &&
    touches(highs, resistance) >= 2;
  const line = (ps: Pivot[], direction: 1 | -1) => {
    const a = ps.at(-2),
      b = ps.at(-1);
    if (
      !a ||
      !b ||
      b.i - a.i < 5 ||
      i - b.i > 40 ||
      (b.p - a.p) * direction <= 0
    )
      return null;
    const slope = (b.p - a.p) / (b.i - a.i);
    for (let j = a.i + 1; j <= i; j++)
      if ((s.c[j] - (a.p + slope * (j - a.i))) * direction < -atr * 0.25)
        return null;
    return a.p + slope * (i - a.i);
  };
  let fib: PriceContext["fib"] = null;
  const hi = highs.at(-1),
    lo = lows.at(-1);
  if (
    hi &&
    lo &&
    Math.abs(hi.p - lo.p) >= atr * 2 &&
    i - Math.max(hi.i, lo.i) <= 30
  ) {
    const span = hi.p - lo.p;
    if (span > 0 && lo.i < hi.i && trend === 1)
      fib = {
        direction: 1,
        low: hi.p - span * 0.618,
        high: hi.p - span * 0.382,
      };
    if (span > 0 && hi.i < lo.i && trend === -1)
      fib = {
        direction: -1,
        low: lo.p + span * 0.382,
        high: lo.p + span * 0.618,
      };
  }
  const result = {
    trend,
    range,
    support,
    resistance,
    lta: line(lows, 1),
    ltb: line(highs, -1),
    fib,
  };
  memo.set(i, result);
  return result;
}
export function contextAllows(s: Series, i: number, d: Direction): boolean {
  if (!d || i < 80 || !Number.isFinite(s.atr[i]) || s.atr[i] <= 0) return false;
  // No trades on empty/stale candles, unconfirmed direction or shock candles.
  if (s.v[i] <= 0 || s.h[i] - s.l[i] > 3 * s.atr[i - 1]) return false;
  const x = priceContext(s, i),
    atr = s.atr[i];
  if (x.trend && x.trend !== d) return false;
  if (!x.trend && !x.range) return false;
  // A range is traded only at its edge with a rejection, never in the middle.
  if (x.range)
    return d === 1
      ? s.l[i] <= x.support + atr * 0.35 &&
          s.c[i] > x.support &&
          s.c[i] > s.o[i]
      : s.h[i] >= x.resistance - atr * 0.35 &&
          s.c[i] < x.resistance &&
          s.c[i] < s.o[i];
  if ((s.c[i] - s.o[i]) * d <= 0) return false;
  return d === 1
    ? !(x.resistance > s.c[i] && x.resistance - s.c[i] < atr * 0.25)
    : !(x.support < s.c[i] && s.c[i] - x.support < atr * 0.25);
}
export function structuralStrategies(): StrategySpec[] {
  return [
    {
      id: "estrutura:lta-ltb:ctx2",
      family: "estrutura",
      label: "LTA/LTB: reteste de linha válida com rejeição",
      signal(s, i) {
        const x = priceContext(s, i),
          a = s.atr[i];
        if (
          x.trend === 1 &&
          x.lta !== null &&
          s.l[i] <= x.lta + a * 0.25 &&
          s.c[i] > x.lta
        )
          return 1;
        if (
          x.trend === -1 &&
          x.ltb !== null &&
          s.h[i] >= x.ltb - a * 0.25 &&
          s.c[i] < x.ltb
        )
          return -1;
        return 0;
      },
    },
    {
      id: "lateral:rejeicao:ctx2",
      family: "lateral",
      label: "Zona lateral: rejeição nas bordas confirmadas",
      signal(s, i) {
        const x = priceContext(s, i);
        if (!x.range) return 0;
        if (
          s.l[i] <= x.support + s.atr[i] * 0.35 &&
          s.c[i] > x.support &&
          s.c[i] > s.o[i]
        )
          return 1;
        if (
          s.h[i] >= x.resistance - s.atr[i] * 0.35 &&
          s.c[i] < x.resistance &&
          s.c[i] < s.o[i]
        )
          return -1;
        return 0;
      },
    },
    {
      id: "fibonacci:382-618:ctx2",
      family: "fibonacci",
      label: "Fibonacci 38,2–61,8%: pullback confirmado a favor da tendência",
      signal(s, i) {
        const f = priceContext(s, i).fib;
        if (!f) return 0;
        if (
          f.direction === 1 &&
          s.l[i] >= f.low - s.atr[i] * 0.15 &&
          s.l[i] <= f.high &&
          s.c[i] > f.high &&
          s.c[i] > s.h[i - 1]
        )
          return 1;
        if (
          f.direction === -1 &&
          s.h[i] <= f.high + s.atr[i] * 0.15 &&
          s.h[i] >= f.low &&
          s.c[i] < f.low &&
          s.c[i] < s.l[i - 1]
        )
          return -1;
        return 0;
      },
    },
  ];
}
