import {
  both,
  sgn,
  type Dir,
  type Series,
  type StrategySpec,
} from "./strategies.js";
// Popular public indicators (TradingView community scripts and classic trader setups),
// reimplemented from their published logic. Every rule reads only bars up to i, and the
// lab decides which of them, if any, earn a place in the robot.
// Indicator arrays are computed once per Series and reused by every bar and variant.
const cache = new WeakMap<Series, Map<string, unknown>>();
function memo<T>(s: Series, key: string, make: () => T): T {
  let m = cache.get(s);
  if (!m) cache.set(s, (m = new Map()));
  if (!m.has(key)) m.set(key, make());
  return m.get(key) as T;
}
const nan = (n: number) => new Float64Array(n).fill(NaN);
function sma(a: Float64Array, n: number) {
  const out = nan(a.length);
  let s = 0,
    bad = 0;
  for (let i = 0; i < a.length; i++) {
    if (Number.isFinite(a[i])) s += a[i];
    else bad++;
    if (i >= n) {
      if (Number.isFinite(a[i - n])) s -= a[i - n];
      else bad--;
    }
    if (i >= n - 1 && !bad) out[i] = s / n;
  }
  return out;
}
function ema(a: Float64Array, n: number, alpha = 2 / (n + 1)) {
  const out = nan(a.length);
  let prev = NaN,
    seed = 0,
    count = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i])) continue;
    if (Number.isNaN(prev)) {
      seed += a[i];
      if (++count === n) out[i] = prev = seed / n;
      continue;
    }
    out[i] = prev = alpha * a[i] + (1 - alpha) * prev;
  }
  return out;
}
const rma = (a: Float64Array, n: number) => ema(a, n, 1 / n);
function highest(a: Float64Array, n: number) {
  const out = nan(a.length);
  for (let i = n - 1; i < a.length; i++) {
    let m = -Infinity;
    for (let j = i - n + 1; j <= i; j++) m = Math.max(m, a[j]);
    out[i] = m;
  }
  return out;
}
function lowest(a: Float64Array, n: number) {
  const out = nan(a.length);
  for (let i = n - 1; i < a.length; i++) {
    let m = Infinity;
    for (let j = i - n + 1; j <= i; j++) m = Math.min(m, a[j]);
    out[i] = m;
  }
  return out;
}
const trueRange = (s: Series) =>
  memo(s, "tr", () =>
    Float64Array.from(s.c, (_, i) =>
      i
        ? Math.max(
            s.h[i] - s.l[i],
            Math.abs(s.h[i] - s.c[i - 1]),
            Math.abs(s.l[i] - s.c[i - 1]),
          )
        : s.h[i] - s.l[i],
    ),
  );
const atr = (s: Series, n: number) =>
  memo(s, `atr${n}`, () => rma(trueRange(s), n));
// SuperTrend (Olivier Seban): ATR bands around the median price that only tighten; the trend
// flips when the close crosses the opposite band.
function superTrend(s: Series, n: number, m: number) {
  return memo(s, `st${n}-${m}`, () => {
    const len = s.c.length,
      a = atr(s, n),
      trend = new Int8Array(len),
      up = nan(len),
      dn = nan(len);
    for (let i = 0; i < len; i++) {
      if (!Number.isFinite(a[i])) continue;
      const hl2 = (s.h[i] + s.l[i]) / 2;
      let u = hl2 - m * a[i],
        d = hl2 + m * a[i];
      if (i && Number.isFinite(up[i - 1])) {
        if (s.c[i - 1] > up[i - 1]) u = Math.max(u, up[i - 1]);
        if (s.c[i - 1] < dn[i - 1]) d = Math.min(d, dn[i - 1]);
        const t = trend[i - 1] || 1;
        trend[i] =
          t === -1 && s.c[i] > dn[i - 1]
            ? 1
            : t === 1 && s.c[i] < up[i - 1]
              ? -1
              : t;
      }
      up[i] = u;
      dn[i] = d;
    }
    return trend;
  });
}
// UT Bot Alerts (QuantNomad / Yo_adriiiiaan): ATR trailing stop; signal when the close crosses it.
function utStop(s: Series, key: number, n: number) {
  return memo(s, `ut${key}-${n}`, () => {
    const len = s.c.length,
      a = atr(s, n),
      stop = nan(len),
      c = s.c;
    for (let i = 1; i < len; i++) {
      if (!Number.isFinite(a[i])) continue;
      const loss = key * a[i],
        p = Number.isFinite(stop[i - 1]) ? stop[i - 1] : c[i] - loss;
      stop[i] =
        c[i] > p && c[i - 1] > p
          ? Math.max(p, c[i] - loss)
          : c[i] < p && c[i - 1] < p
            ? Math.min(p, c[i] + loss)
            : c[i] > p
              ? c[i] - loss
              : c[i] + loss;
    }
    return stop;
  });
}
// Squeeze Momentum (LazyBear): Bollinger inside Keltner = squeeze; momentum is the linear
// regression of the close against the mid of the Donchian channel and its SMA.
function squeeze(s: Series) {
  return memo(s, "sqz", () => {
    const len = s.c.length,
      n = 20,
      mean = sma(s.c, n),
      rangeMa = sma(trueRange(s), n),
      hh = highest(s.h, n),
      ll = lowest(s.l, n),
      on = new Uint8Array(len),
      val = nan(len),
      x = new Float64Array(len);
    for (let i = n - 1; i < len; i++) {
      const sd = s.bbStd[i];
      on[i] = Number(2 * sd < 1.5 * rangeMa[i]);
      x[i] = s.c[i] - ((hh[i] + ll[i]) / 2 + mean[i]) / 2;
    }
    // Linear regression value at the last bar of a 20-bar window.
    const sx = (n * (n - 1)) / 2,
      sxx = ((n - 1) * n * (2 * n - 1)) / 6;
    for (let i = 2 * n - 2; i < len; i++) {
      let sy = 0,
        sxy = 0;
      for (let k = 0; k < n; k++) {
        const y = x[i - n + 1 + k];
        sy += y;
        sxy += k * y;
      }
      const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx),
        icpt = (sy - slope * sx) / n;
      val[i] = icpt + slope * (n - 1);
    }
    return { on, val };
  });
}
// Ichimoku Kinko Hyo (9, 26, 52). The cloud at bar i is the one projected 26 bars earlier.
function ichimoku(s: Series) {
  return memo(s, "ichi", () => {
    const len = s.c.length,
      mid = (n: number) => {
        const hh = highest(s.h, n),
          ll = lowest(s.l, n);
        return Float64Array.from(hh, (v, i) => (v + ll[i]) / 2);
      },
      tenkan = mid(9),
      kijun = mid(26),
      b = mid(52),
      top = nan(len),
      bottom = nan(len);
    for (let i = 26; i < len; i++) {
      const a = (tenkan[i - 26] + kijun[i - 26]) / 2;
      top[i] = Math.max(a, b[i - 26]);
      bottom[i] = Math.min(a, b[i - 26]);
    }
    return { tenkan, kijun, top, bottom };
  });
}
// Stochastic RSI (14, 14, 3, 3).
function stochRsi(s: Series) {
  return memo(s, "srsi", () => {
    const r = s.rsi14,
      hi = highest(r, 14),
      lo = lowest(r, 14),
      raw = Float64Array.from(r, (v, i) =>
        hi[i] > lo[i] ? ((v - lo[i]) / (hi[i] - lo[i])) * 100 : NaN,
      ),
      k = sma(raw, 3);
    return { k, d: sma(k, 3) };
  });
}
function macd(s: Series) {
  return memo(s, "macd", () => {
    const f = ema(s.c, 12),
      sl = ema(s.c, 26),
      line = Float64Array.from(f, (v, i) => v - sl[i]),
      signal = ema(line, 9);
    return { line, signal };
  });
}
// ADX with +DI/-DI (Wilder, 14).
function dmi(s: Series) {
  return memo(s, "dmi", () => {
    const len = s.c.length,
      p = new Float64Array(len),
      m = new Float64Array(len);
    for (let i = 1; i < len; i++) {
      const u = s.h[i] - s.h[i - 1],
        d = s.l[i - 1] - s.l[i];
      p[i] = u > d && u > 0 ? u : 0;
      m[i] = d > u && d > 0 ? d : 0;
    }
    const a = s.atr,
      sp = rma(p, 14),
      sm = rma(m, 14),
      plus = Float64Array.from(sp, (v, i) => (100 * v) / a[i]),
      minus = Float64Array.from(sm, (v, i) => (100 * v) / a[i]),
      dx = Float64Array.from(plus, (v, i) =>
        v + minus[i] ? (100 * Math.abs(v - minus[i])) / (v + minus[i]) : 0,
      );
    return { plus, minus, adx: rma(dx, 14) };
  });
}
function heikinAshi(s: Series) {
  return memo(s, "ha", () => {
    const len = s.c.length,
      o = new Float64Array(len),
      c = new Float64Array(len),
      h = new Float64Array(len),
      l = new Float64Array(len);
    for (let i = 0; i < len; i++) {
      c[i] = (s.o[i] + s.h[i] + s.l[i] + s.c[i]) / 4;
      o[i] = i ? (o[i - 1] + c[i - 1]) / 2 : (s.o[i] + s.c[i]) / 2;
      h[i] = Math.max(s.h[i], o[i], c[i]);
      l[i] = Math.min(s.l[i], o[i], c[i]);
    }
    return { o, c, h, l };
  });
}
// Parabolic SAR (Wilder, 0.02 step, 0.2 max): +1 while below price, -1 while above.
function psar(s: Series) {
  return memo(s, "psar", () => {
    const len = s.c.length,
      dir = new Int8Array(len);
    if (len < 2) return dir;
    let up = s.c[1] >= s.c[0],
      sar = up ? s.l[0] : s.h[0],
      ep = up ? s.h[1] : s.l[1],
      af = 0.02;
    dir[1] = up ? 1 : -1;
    for (let i = 2; i < len; i++) {
      sar += af * (ep - sar);
      if (up) {
        sar = Math.min(sar, s.l[i - 1], s.l[i - 2]);
        if (s.l[i] < sar) {
          up = false;
          sar = ep;
          ep = s.l[i];
          af = 0.02;
        } else if (s.h[i] > ep) {
          ep = s.h[i];
          af = Math.min(0.2, af + 0.02);
        }
      } else {
        sar = Math.max(sar, s.h[i - 1], s.h[i - 2]);
        if (s.h[i] > sar) {
          up = true;
          sar = ep;
          ep = s.h[i];
          af = 0.02;
        } else if (s.l[i] < ep) {
          ep = s.l[i];
          af = Math.min(0.2, af + 0.02);
        }
      }
      dir[i] = up ? 1 : -1;
    }
    return dir;
  });
}
const crossUp = (a: Float64Array, b: Float64Array, i: number) =>
  i > 0 && a[i - 1] <= b[i - 1] && a[i] > b[i];
const crossDown = (a: Float64Array, b: Float64Array, i: number) =>
  i > 0 && a[i - 1] >= b[i - 1] && a[i] < b[i];
// Five independent trend readings; the confluence family enters when they newly agree.
function votes(s: Series, i: number) {
  const m = macd(s),
    ic = ichimoku(s),
    ha = heikinAshi(s),
    v = [
      superTrend(s, 10, 3)[i],
      sgn(m.line[i] - m.signal[i]),
      s.c[i] > ic.top[i] ? 1 : s.c[i] < ic.bottom[i] ? -1 : 0,
      sgn(ha.c[i] - ha.o[i]),
      sgn(s.ema9[i] - s.ema21[i]),
    ];
  return {
    up: v.filter((x) => x === 1).length,
    down: v.filter((x) => x === -1).length,
  };
}
export function famousStrategies(): StrategySpec[] {
  const out: StrategySpec[] = [];
  for (const [n, m] of [
    [10, 3],
    [10, 2],
    [7, 2],
  ])
    out.push(
      ...both(
        "supertrend",
        `${n}-${m}`,
        `SuperTrend(${n}, ${m}) virou`,
        (s, i) => {
          const t = superTrend(s, n, m);
          return i && t[i - 1] && t[i] !== t[i - 1] ? (t[i] as Dir) : 0;
        },
      ),
    );
  for (const key of [1, 2])
    out.push(
      ...both(
        "utbot",
        String(key),
        `UT Bot (sensibilidade ${key}, ATR 10)`,
        (s, i) => {
          const st = utStop(s, key, 10);
          return crossUp(s.c, st, i) ? 1 : crossDown(s.c, st, i) ? -1 : 0;
        },
      ),
    );
  out.push(
    ...both("squeeze", "soltou", "Squeeze Momentum: saiu do aperto", (s, i) => {
      const q = squeeze(s);
      if (!i || !q.on[i - 1] || q.on[i]) return 0;
      const d = sgn(q.val[i]);
      return d && sgn(q.val[i] - q.val[i - 1]) === d ? d : 0;
    }),
    ...both(
      "squeeze",
      "zero",
      "Squeeze Momentum: momento cruzou o zero",
      (s, i) => {
        const q = squeeze(s);
        if (!i || q.on[i]) return 0;
        return q.val[i - 1] <= 0 && q.val[i] > 0
          ? 1
          : q.val[i - 1] >= 0 && q.val[i] < 0
            ? -1
            : 0;
      },
    ),
  );
  out.push(
    ...both(
      "ichimoku",
      "tk",
      "Ichimoku: Tenkan cruza Kijun fora da nuvem",
      (s, i) => {
        const x = ichimoku(s);
        if (crossUp(x.tenkan, x.kijun, i) && s.c[i] > x.top[i]) return 1;
        if (crossDown(x.tenkan, x.kijun, i) && s.c[i] < x.bottom[i]) return -1;
        return 0;
      },
    ),
    ...both("ichimoku", "nuvem", "Ichimoku: fechou fora da nuvem", (s, i) => {
      const x = ichimoku(s);
      if (!i) return 0;
      if (
        s.c[i] > x.top[i] &&
        s.c[i - 1] <= x.top[i - 1] &&
        x.tenkan[i] > x.kijun[i]
      )
        return 1;
      if (
        s.c[i] < x.bottom[i] &&
        s.c[i - 1] >= x.bottom[i - 1] &&
        x.tenkan[i] < x.kijun[i]
      )
        return -1;
      return 0;
    }),
  );
  for (const lv of [20, 30])
    out.push(
      ...both(
        "stoch-rsi",
        String(lv),
        `Stoch RSI: K cruza D abaixo de ${lv} / acima de ${100 - lv}`,
        (s, i) => {
          const { k, d } = stochRsi(s);
          if (crossUp(k, d, i) && d[i] < lv) return 1;
          if (crossDown(k, d, i) && d[i] > 100 - lv) return -1;
          return 0;
        },
      ),
    );
  out.push(
    ...both(
      "macd",
      "cruz",
      "MACD(12, 26, 9) cruza a linha de sinal",
      (s, i) => {
        const m = macd(s);
        return crossUp(m.line, m.signal, i)
          ? 1
          : crossDown(m.line, m.signal, i)
            ? -1
            : 0;
      },
    ),
    ...both(
      "macd",
      "zero",
      "MACD cruza o sinal do lado certo do zero (recuo na tendência)",
      (s, i) => {
        const m = macd(s);
        if (crossUp(m.line, m.signal, i) && m.line[i] < 0) return 1;
        if (crossDown(m.line, m.signal, i) && m.line[i] > 0) return -1;
        return 0;
      },
    ),
    ...both(
      "macd",
      "rsi",
      "MACD cruza o sinal com RSI(14) do mesmo lado de 50",
      (s, i) => {
        const m = macd(s),
          r = s.rsi14[i];
        if (crossUp(m.line, m.signal, i) && r > 50) return 1;
        if (crossDown(m.line, m.signal, i) && r < 50) return -1;
        return 0;
      },
    ),
  );
  for (const lv of [20, 25])
    out.push(
      ...both(
        "adx",
        String(lv),
        `+DI cruza -DI com ADX acima de ${lv}`,
        (s, i) => {
          const x = dmi(s);
          if (!(x.adx[i] > lv)) return 0;
          return crossUp(x.plus, x.minus, i)
            ? 1
            : crossDown(x.plus, x.minus, i)
              ? -1
              : 0;
        },
      ),
    );
  for (const n of [1, 2])
    out.push(
      ...both(
        "heikin-ashi",
        String(n),
        `Heikin Ashi virou com ${n} candle(s) forte(s) sem pavio contra`,
        (s, i) => {
          const x = heikinAshi(s);
          if (i <= n) return 0;
          const col = (j: number) => sgn(x.c[j] - x.o[j]),
            strong = (j: number, d: Dir) =>
              col(j) === d && (d === 1 ? x.l[j] >= x.o[j] : x.h[j] <= x.o[j]),
            d = col(i);
          if (!d || col(i - n) !== -d) return 0;
          for (let j = i - n + 1; j <= i; j++) if (!strong(j, d)) return 0;
          return d;
        },
      ),
    );
  for (const n of [20, 55])
    out.push(
      ...both(
        "donchian",
        String(n),
        `Rompimento do canal Donchian(${n}) (Turtle)`,
        (s, i) => {
          if (i < n + 1) return 0;
          let hh = -Infinity,
            ll = Infinity;
          for (let j = i - n; j < i; j++) {
            hh = Math.max(hh, s.h[j]);
            ll = Math.min(ll, s.l[j]);
          }
          return s.c[i] > hh ? 1 : s.c[i] < ll ? -1 : 0;
        },
      ),
    );
  out.push(
    ...both("psar", "0.02", "Parabolic SAR (0,02 / 0,2) virou", (s, i) => {
      const d = psar(s);
      return i > 1 && d[i - 1] && d[i] !== d[i - 1] ? (d[i] as Dir) : 0;
    }),
  );
  for (const need of [4, 5])
    out.push(
      ...both(
        "confluencia",
        String(need),
        `${need} de 5 concordam: SuperTrend, MACD, Ichimoku, Heikin Ashi, EMA 9/21`,
        (s, i) => {
          if (!i) return 0;
          const v = votes(s, i),
            p = votes(s, i - 1);
          if (v.up >= need && p.up < need) return 1;
          if (v.down >= need && p.down < need) return -1;
          return 0;
        },
      ),
    );
  return out;
}
