import {
  both,
  sgn,
  type Dir,
  type Series,
  type StrategySpec,
} from "./strategies.js";
// Setups taught to binary-option traders (MHI, Milhão, price action on M5, RSI divergence,
// Bollinger + Estocástico). They read closed 5-minute candles built from the 1m series and
// fire only when a 5-minute candle has just closed. The lab decides which of them hold up.
const M = 5,
  MIN = 60000;
// True when bar i closes a 5-minute candle.
const closes5 = (s: Series, i: number) => (s.t[i] + MIN) % (M * MIN) === 0;
type Bar = { o: number; h: number; l: number; c: number };
// The k-th 5-minute candle back (0 = the one that just closed), or null if it has a gap.
function bar5(s: Series, i: number, k: number): Bar | null {
  const end = i - k * M,
    start = end - M + 1;
  if (start < 0 || s.t[end] - s.t[start] !== (M - 1) * MIN) return null;
  let h = -Infinity,
    l = Infinity;
  for (let j = start; j <= end; j++) {
    h = Math.max(h, s.h[j]);
    l = Math.min(l, s.l[j]);
  }
  return { o: s.o[start], h, l, c: s.c[end] };
}
function bars5(s: Series, i: number, n: number): Bar[] | null {
  const out: Bar[] = [];
  for (let k = 0; k < n; k++) {
    const b = bar5(s, i, k);
    if (!b) return null;
    out.push(b);
  }
  return out;
}
const color = (b: Bar): Dir => sgn(b.c - b.o);
// Majority or minority colour of the last n closed 5-minute candles; any doji cancels (MHI rule).
function crowd(s: Series, i: number, n: number, minority: boolean): Dir {
  if (!closes5(s, i)) return 0;
  const bs = bars5(s, i, n);
  if (!bs) return 0;
  let up = 0;
  for (const b of bs) {
    const c = color(b);
    if (!c) return 0;
    if (c > 0) up++;
  }
  const major: Dir = up * 2 > n ? 1 : -1;
  return minority ? (-major as Dir) : major;
}
// Fast stochastic %K(5) smoothed by 3, computed on the 1m series.
const stochCache = new WeakMap<Series, Float64Array>();
function stochK(s: Series) {
  let k = stochCache.get(s);
  if (k) return k;
  const n = s.c.length,
    raw = new Float64Array(n).fill(NaN);
  for (let i = 4; i < n; i++) {
    let hh = -Infinity,
      ll = Infinity;
    for (let j = i - 4; j <= i; j++) {
      hh = Math.max(hh, s.h[j]);
      ll = Math.min(ll, s.l[j]);
    }
    raw[i] = hh > ll ? ((s.c[i] - ll) / (hh - ll)) * 100 : 50;
  }
  k = new Float64Array(n).fill(NaN);
  for (let i = 6; i < n; i++) k[i] = (raw[i] + raw[i - 1] + raw[i - 2]) / 3;
  stochCache.set(s, k);
  return k;
}
export function binaryStrategies(): StrategySpec[] {
  const out: StrategySpec[] = [];
  // MHI: the last 3 candles of M5; Milhão: the last 5.
  for (const [name, n] of [
    ["mhi", 3],
    ["milhao", 5],
  ] as const)
    for (const minority of [true, false])
      out.push(
        ...both(
          name,
          minority ? "minoria" : "maioria",
          `${name === "mhi" ? "MHI" : "Milhão"} ${minority ? "minoria" : "maioria"} (últimas ${n} velas de M5)`,
          (s, i) => crowd(s, i, n, minority),
        ),
      );
  // Engulfing M5 candle, anywhere or only at support/resistance.
  for (const atLevel of [false, true])
    out.push(
      ...both(
        "engolfo",
        atLevel ? "sr" : "livre",
        `Engolfo em M5${atLevel ? " no suporte/resistência" : ""}`,
        (s, i) => {
          if (!closes5(s, i)) return 0;
          const b = bars5(s, i, 2);
          if (!b) return 0;
          const [now, prev] = b,
            d = color(now);
          if (!d || color(prev) !== -d) return 0;
          const top = Math.max(prev.o, prev.c),
            bottom = Math.min(prev.o, prev.c);
          if (Math.max(now.o, now.c) < top || Math.min(now.o, now.c) > bottom)
            return 0;
          if (!atLevel) return d;
          const a = s.atr[i];
          return d === 1
            ? now.l <= s.sup[i - M] + a
              ? 1
              : 0
            : now.h >= s.res[i - M] - a
              ? -1
              : 0;
        },
      ),
    );
  // Pin bar (martelo / estrela cadente) on M5: the rejection wick is at least twice the body.
  for (const atLevel of [false, true])
    out.push(
      ...both(
        "martelo",
        atLevel ? "sr" : "livre",
        `Martelo/estrela cadente em M5${atLevel ? " no suporte/resistência" : ""}`,
        (s, i) => {
          if (!closes5(s, i)) return 0;
          const b = bar5(s, i, 0);
          if (!b) return 0;
          const body = Math.abs(b.c - b.o),
            range = b.h - b.l,
            low = Math.min(b.o, b.c) - b.l,
            high = b.h - Math.max(b.o, b.c);
          if (!(range > 0) || body > range / 3) return 0;
          const a = s.atr[i];
          if (
            low >= 2 * Math.max(body, range * 0.05) &&
            high < body + range * 0.1
          )
            return !atLevel || b.l <= s.sup[i - M] + a ? 1 : 0;
          if (
            high >= 2 * Math.max(body, range * 0.05) &&
            low < body + range * 0.1
          )
            return !atLevel || b.h >= s.res[i - M] - a ? -1 : 0;
          return 0;
        },
      ),
    );
  // Vela de força: an M5 body that fills the candle and is well above the recent average.
  for (const k of [1.5, 2])
    out.push(
      ...both(
        "vela-forca",
        String(k),
        `Vela de força em M5 (corpo > ${k}x a média)`,
        (s, i) => {
          if (!closes5(s, i)) return 0;
          const bs = bars5(s, i, 11);
          if (!bs) return 0;
          const [now, ...rest] = bs,
            body = Math.abs(now.c - now.o),
            avg =
              rest.reduce((m, b) => m + Math.abs(b.c - b.o), 0) / rest.length;
          if (!(avg > 0) || body < k * avg || body < 0.7 * (now.h - now.l))
            return 0;
          return color(now);
        },
      ),
    );
  // Regular RSI divergence: a new price extreme that RSI(14) does not confirm, then a turn.
  for (const back of [30, 60])
    out.push(
      ...both(
        "divergencia",
        String(back),
        `Divergência de RSI (janela ${back} min)`,
        (s, i) => {
          if (i < back + 5) return 0;
          let lowNow = Infinity,
            rsiLowNow = Infinity,
            highNow = -Infinity,
            rsiHighNow = -Infinity,
            lowBefore = Infinity,
            rsiLowBefore = Infinity,
            highBefore = -Infinity,
            rsiHighBefore = -Infinity;
          for (let j = i - 4; j <= i; j++) {
            lowNow = Math.min(lowNow, s.l[j]);
            highNow = Math.max(highNow, s.h[j]);
            rsiLowNow = Math.min(rsiLowNow, s.rsi14[j]);
            rsiHighNow = Math.max(rsiHighNow, s.rsi14[j]);
          }
          for (let j = i - back; j < i - 4; j++) {
            lowBefore = Math.min(lowBefore, s.l[j]);
            highBefore = Math.max(highBefore, s.h[j]);
            rsiLowBefore = Math.min(rsiLowBefore, s.rsi14[j]);
            rsiHighBefore = Math.max(rsiHighBefore, s.rsi14[j]);
          }
          const turnUp = s.c[i] > s.o[i] && s.rsi14[i] > s.rsi14[i - 1],
            turnDown = s.c[i] < s.o[i] && s.rsi14[i] < s.rsi14[i - 1];
          if (
            lowNow < lowBefore &&
            rsiLowNow > rsiLowBefore &&
            rsiLowNow < 40 &&
            turnUp
          )
            return 1;
          if (
            highNow > highBefore &&
            rsiHighNow < rsiHighBefore &&
            rsiHighNow > 60 &&
            turnDown
          )
            return -1;
          return 0;
        },
      ),
    );
  // Bollinger(20, 2) + Estocástico(5, 3): price outside the band and %K turning back from the extreme.
  for (const lv of [20, 10])
    out.push(
      ...both(
        "bb-estocastico",
        String(lv),
        `Bollinger + Estocástico (${lv}/${100 - lv})`,
        (s, i) => {
          if (i < 1) return 0;
          const k = stochK(s),
            d = s.c[i] - s.bbMid[i],
            out2 = Math.abs(d) > 2 * s.bbStd[i];
          if (
            !out2 &&
            Math.abs(s.c[i - 1] - s.bbMid[i - 1]) <= 2 * s.bbStd[i - 1]
          )
            return 0;
          if (k[i - 1] < lv && k[i] > k[i - 1] && d < 0) return 1;
          if (k[i - 1] > 100 - lv && k[i] < k[i - 1] && d > 0) return -1;
          return 0;
        },
      ),
    );
  return out;
}
