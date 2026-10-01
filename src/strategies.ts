import { binaryStrategies } from "./binary.js";
import { adxAt, famousStrategies } from "./famous.js";
import {
  contextAllows,
  priceContext,
  structuralStrategies,
} from "./price-context.js";
import type { Candle, Horizon } from "./types.js";
// Rule-based strategies on closed 1m candles, validated by chronological backtest.
// Selection happens on the in-sample slice only; approval uses the untouched out-of-sample slice.
export interface Series {
  t: Float64Array;
  o: Float64Array;
  h: Float64Array;
  l: Float64Array;
  c: Float64Array;
  v: Float64Array;
  buy: Float64Array;
  rsi7: Float64Array;
  rsi14: Float64Array;
  ema9: Float64Array;
  ema21: Float64Array;
  ema50: Float64Array;
  bbMid: Float64Array;
  bbStd: Float64Array;
  atr: Float64Array;
  vwap: Float64Array;
  sigma: Float64Array;
  volAvg: Float64Array;
  // Nearest support below / resistance above the close, from confirmed swing points (NaN if none).
  sup: Float64Array;
  res: Float64Array;
}
export type Dir = -1 | 0 | 1;
export interface StrategySpec {
  id: string;
  family: string;
  label: string;
  signal: (s: Series, i: number) => Dir;
}
export interface Tally {
  trades: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: number | null;
  lower: number | null;
}
export interface Evaluation {
  symbol: string;
  horizon: Horizon;
  id: string;
  family: string;
  label: string;
  inSample: Tally;
  outOfSample: Tally;
  halves: [Tally, Tally];
  approved: boolean;
  reason: string;
}
export const WARMUP = 300;
function ema(a: Float64Array, n: number, alpha = 2 / (n + 1)) {
  const out = new Float64Array(a.length).fill(NaN);
  if (a.length < n) return out;
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i];
  out[n - 1] = s / n;
  for (let i = n; i < a.length; i++)
    out[i] = alpha * a[i] + (1 - alpha) * out[i - 1];
  return out;
}
function rsi(c: Float64Array, n: number) {
  const out = new Float64Array(c.length).fill(NaN);
  let g = 0,
    l = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1],
      up = Math.max(0, d),
      dn = Math.max(0, -d);
    if (i <= n) {
      g += up / n;
      l += dn / n;
      if (i < n) continue;
    } else {
      g = (g * (n - 1) + up) / n;
      l = (l * (n - 1) + dn) / n;
    }
    out[i] = l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l);
  }
  return out;
}
function rolling(a: Float64Array, n: number) {
  const mean = new Float64Array(a.length).fill(NaN),
    std = new Float64Array(a.length).fill(NaN);
  let s = 0,
    q = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i];
    q += a[i] * a[i];
    if (i >= n) {
      s -= a[i - n];
      q -= a[i - n] * a[i - n];
    }
    if (i >= n - 1) {
      const m = s / n;
      mean[i] = m;
      std[i] = Math.sqrt(Math.max(0, q / n - m * m));
    }
  }
  return { mean, std };
}
export function buildSeries(cs: Candle[]): Series {
  const n = cs.length,
    f = (k: keyof Candle) => Float64Array.from(cs, (x) => x[k]);
  const t = f("t"),
    o = f("o"),
    h = f("h"),
    l = f("l"),
    c = f("c"),
    v = f("v"),
    buy = f("buy");
  const tr = new Float64Array(n);
  for (let i = 0; i < n; i++)
    tr[i] = i
      ? Math.max(
          h[i] - l[i],
          Math.abs(h[i] - c[i - 1]),
          Math.abs(l[i] - c[i - 1]),
        )
      : h[i] - l[i];
  const ret = new Float64Array(n);
  for (let i = 1; i < n; i++) ret[i] = c[i] / c[i - 1] - 1;
  const bb = rolling(c, 20),
    vol = rolling(ret, 120),
    va = rolling(v, 60);
  const e21 = ema(c, 21),
    e50 = ema(c, 50),
    atr = ema(tr, 14, 1 / 14);
  const { sup, res } = swingLevels(h, l, c, atr);
  const vwap = new Float64Array(n);
  let day = -1,
    pv = 0,
    vs = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.floor(t[i] / 86400000);
    if (d !== day) {
      day = d;
      pv = 0;
      vs = 0;
    }
    pv += ((h[i] + l[i] + c[i]) / 3) * v[i];
    vs += v[i];
    vwap[i] = vs ? pv / vs : c[i];
  }
  return {
    t,
    o,
    h,
    l,
    c,
    v,
    buy,
    rsi7: rsi(c, 7),
    rsi14: rsi(c, 14),
    ema9: ema(c, 9),
    ema21: e21,
    ema50: e50,
    bbMid: bb.mean,
    bbStd: bb.std,
    atr,
    vwap,
    sigma: vol.std,
    volAvg: va.mean,
    sup,
    res,
  };
}
export const SWING = 5,
  SWING_WINDOW = 240;
export interface Level {
  price: number;
  touches: number;
  kind: "sup" | "res";
  last: number;
}
// Swing highs/lows: the bar's high (low) is the extreme of SWING bars on each side.
// A swing at j is only known at j + SWING, so nothing here looks ahead.
function swings(h: Float64Array, l: Float64Array) {
  const hi: number[] = [],
    lo: number[] = [];
  for (let j = SWING; j < h.length - SWING; j++) {
    let isHi = true,
      isLo = true;
    for (let k = 1; k <= SWING && (isHi || isLo); k++) {
      if (h[j - k] > h[j] || h[j + k] >= h[j]) isHi = false;
      if (l[j - k] < l[j] || l[j + k] <= l[j]) isLo = false;
    }
    if (isHi) hi.push(j);
    if (isLo) lo.push(j);
  }
  return { hi, lo };
}
// Levels touched at least twice (swing points within 0.3 ATR of each other) in the last
// SWING_WINDOW bars; support is the nearest one below the close, resistance the nearest above.
function swingLevels(
  h: Float64Array,
  l: Float64Array,
  c: Float64Array,
  atr: Float64Array,
) {
  const n = c.length,
    sup = new Float64Array(n).fill(NaN),
    res = new Float64Array(n).fill(NaN),
    { hi, lo } = swings(h, l),
    pts = [
      ...hi.map((j) => ({ j, p: h[j] })),
      ...lo.map((j) => ({ j, p: l[j] })),
    ].sort((a, b) => a.j - b.j);
  let start = 0,
    end = 0;
  for (let i = 0; i < n; i++) {
    while (end < pts.length && pts[end].j + SWING <= i) end++;
    while (start < end && pts[start].j < i - SWING_WINDOW) start++;
    const a = atr[i];
    if (!Number.isFinite(a) || end - start < 2) continue;
    const tol = 0.3 * a;
    let s = NaN,
      r = NaN;
    for (let x = start; x < end; x++) {
      const p = pts[x].p;
      if (Math.abs(p - c[i]) > 6 * a) continue;
      if (
        p < c[i] ? !(p > s) && !Number.isNaN(s) : !(p < r) && !Number.isNaN(r)
      )
        continue;
      let touches = 0;
      for (let y = start; y < end; y++)
        if (Math.abs(pts[y].p - p) <= tol) touches++;
      if (touches < 2) continue;
      if (p < c[i]) s = p;
      else r = p;
    }
    sup[i] = s;
    res[i] = r;
  }
  return { sup, res };
}
// Support/resistance zones for drawing: every level touched at least twice in the window,
// merged when close together, strongest first.
export function levelsAt(s: Series, i = s.c.length - 1, max = 6): Level[] {
  const a = s.atr[i];
  if (!Number.isFinite(a)) return [];
  const from = Math.max(0, i - SWING_WINDOW),
    { hi, lo } = swings(s.h.subarray(from, i + 1), s.l.subarray(from, i + 1)),
    pts = [
      ...hi.map((j) => ({ j: j + from, p: s.h[j + from] })),
      ...lo.map((j) => ({ j: j + from, p: s.l[j + from] })),
    ].sort((x, y) => x.p - y.p),
    tol = 0.3 * a,
    out: Level[] = [];
  let group: typeof pts = [];
  const flush = () => {
    if (group.length >= 2) {
      const price = group.reduce((m, x) => m + x.p, 0) / group.length;
      out.push({
        price,
        touches: group.length,
        kind: price < s.c[i] ? "sup" : "res",
        last: s.t[Math.max(...group.map((x) => x.j))],
      });
    }
    group = [];
  };
  for (const pt of pts) {
    if (group.length && pt.p - group[0].p > tol) flush();
    group.push(pt);
  }
  flush();
  return out
    .sort(
      (x, y) =>
        y.touches - x.touches ||
        Math.abs(x.price - s.c[i]) - Math.abs(y.price - s.c[i]),
    )
    .slice(0, max);
}
export const sgn = (x: number): Dir => (x > 0 ? 1 : x < 0 ? -1 : 0);
// Each family is tested both ways ("seguir" follows the move, "reverter" fades it); the data decides.
export function both(
  family: string,
  key: string,
  label: string,
  base: (s: Series, i: number) => Dir,
): StrategySpec[] {
  return [
    {
      id: `${family}:${key}:seguir`,
      family,
      label: `${label} · seguir`,
      signal: base,
    },
    {
      id: `${family}:${key}:reverter`,
      family,
      label: `${label} · reverter`,
      signal: (s, i) => (-base(s, i) || 0) as Dir,
    },
  ];
}
export function catalog(): StrategySpec[] {
  // Precision-first catalog: candle/price-action patterns plus structural chart
  // patterns. Generic indicator-only systems were intentionally removed.
  // Indicators still exist inside buildSeries only as confirmation/context; they
  // are not allowed to originate a trade by themselves.
  const out: StrategySpec[] = [];
  out.push(...binaryStrategies());
  out.push(...structuralStrategies());
  return out.map((spec) => ({
    ...spec,
    id: spec.id.includes(":ctx2")
      ? spec.id
      : spec.id.replace(/:(seguir|reverter)$/, ":ctx2:$1"),
    signal: (s, i) => {
      const d = spec.signal(s, i);
      if (!d) return 0;
      // Never allow a candle pattern to fight a confirmed price trend.
      // Structural patterns already encode their own regime.
      if (!["lateral", "estrutura", "fibonacci"].includes(spec.family)) {
        const x = priceContext(s, i);
        if (x.trend && x.trend !== d) return 0;
      }
      return contextAllows(s, i, d) ? d : 0;
    },
  }));
}
function legacyCatalogUnused(): StrategySpec[] {
  const out: StrategySpec[] = [];
  for (const n of [7, 14])
    for (const lv of [20, 25, 30])
      out.push(
        ...both(
          "rsi",
          `${n}-${lv}`,
          `RSI(${n}) fora de ${lv}/${100 - lv}`,
          (s, i) => {
            const r = n === 7 ? s.rsi7[i] : s.rsi14[i];
            return r > 100 - lv ? 1 : r < lv ? -1 : 0;
          },
        ),
      );
  for (const k of [2, 2.5, 3])
    out.push(
      ...both(
        "bollinger",
        String(k),
        `Fechamento fora da Bollinger(20, ${k})`,
        (s, i) => {
          const d = s.c[i] - s.bbMid[i];
          return Math.abs(d) > k * s.bbStd[i] ? sgn(d) : 0;
        },
      ),
    );
  for (const m of [3, 5, 10])
    for (const z of [1.5, 2.5])
      out.push(
        ...both(
          "impulso",
          `${m}-${z}`,
          `Impulso de ${m} min acima de ${z}σ`,
          (s, i) => {
            if (i < m) return 0;
            const r = s.c[i] / s.c[i - m] - 1;
            return Math.abs(r) > z * s.sigma[i] * Math.sqrt(m) ? sgn(r) : 0;
          },
        ),
      );
  for (const n of [4, 5, 6])
    out.push(
      ...both(
        "sequencia",
        String(n),
        `${n} candles seguidos na mesma cor`,
        (s, i) => {
          if (i < n) return 0;
          const d = sgn(s.c[i] - s.o[i]);
          if (!d) return 0;
          for (let j = 1; j < n; j++)
            if (sgn(s.c[i - j] - s.o[i - j]) !== d) return 0;
          return d;
        },
      ),
    );
  for (const tol of [0, 0.25])
    out.push(
      ...both(
        "pullback",
        String(tol),
        `Pullback na EMA21 com tendência (tol ${tol} ATR)`,
        (s, i) => {
          const up = s.ema9[i] > s.ema21[i] && s.ema21[i] > s.ema50[i],
            dn = s.ema9[i] < s.ema21[i] && s.ema21[i] < s.ema50[i],
            tl = tol * s.atr[i];
          if (up && s.l[i] <= s.ema21[i] + tl && s.c[i] > s.ema21[i]) return 1;
          if (dn && s.h[i] >= s.ema21[i] - tl && s.c[i] < s.ema21[i]) return -1;
          return 0;
        },
      ),
    );
  for (const k of [3, 5, 8])
    out.push(
      ...both(
        "vwap",
        String(k),
        `Distância da VWAP acima de ${k} ATR`,
        (s, i) => {
          const d = (s.c[i] - s.vwap[i]) / s.atr[i];
          return Math.abs(d) > k ? sgn(d) : 0;
        },
      ),
    );
  for (const k of [3, 5])
    for (const x of [0.1, 0.15])
      out.push(
        ...both(
          "fluxo",
          `${k}-${x}`,
          `Fluxo agressor ${k} min > ${Math.round((0.5 + x) * 100)}% com volume 1,5x`,
          (s, i) => {
            if (i < k) return 0;
            let b = 0,
              v = 0;
            for (let j = 0; j < k; j++) {
              b += s.buy[i - j];
              v += s.v[i - j];
            }
            if (!v || v / k < 1.5 * s.volAvg[i]) return 0;
            const r = b / v - 0.5;
            return Math.abs(r) > x ? sgn(r) : 0;
          },
        ),
      );
  for (const k of [2, 3])
    out.push(
      ...both(
        "exaustao",
        String(k),
        `Candle com amplitude > ${k} ATR`,
        (s, i) =>
          s.h[i] - s.l[i] > k * s.atr[i - 1] ? sgn(s.c[i] - s.o[i]) : 0,
      ),
    );
  for (const lv of [20, 25])
    out.push(
      ...both(
        "rsi-bollinger",
        String(lv),
        `RSI(7) fora de ${lv}/${100 - lv} + Bollinger(20, 2)`,
        (s, i) => {
          const d = s.c[i] - s.bbMid[i];
          if (Math.abs(d) <= 2 * s.bbStd[i]) return 0;
          return d > 0 && s.rsi7[i] > 100 - lv
            ? 1
            : d < 0 && s.rsi7[i] < lv
              ? -1
              : 0;
        },
      ),
    );
  // Support/resistance from swing points touched at least twice.
  for (const tol of [0.1, 0.3])
    out.push(
      ...both(
        "sr-toque",
        String(tol),
        `Toque no suporte/resistência (tol ${tol} ATR)`,
        (s, i) => {
          const a = tol * s.atr[i];
          if (s.l[i] <= s.sup[i] + a && s.c[i] > s.sup[i] && s.c[i] > s.o[i])
            return 1;
          if (s.h[i] >= s.res[i] - a && s.c[i] < s.res[i] && s.c[i] < s.o[i])
            return -1;
          return 0;
        },
      ),
    );
  for (const k of [0.1, 0.3])
    out.push(
      ...both(
        "sr-rompimento",
        String(k),
        `Rompimento de suporte/resistência (> ${k} ATR)`,
        (s, i) => {
          if (i < 1) return 0;
          const a = k * s.atr[i];
          if (s.c[i] > s.res[i - 1] + a && s.c[i - 1] <= s.res[i - 1]) return 1;
          if (s.c[i] < s.sup[i - 1] - a && s.c[i - 1] >= s.sup[i - 1])
            return -1;
          return 0;
        },
      ),
    );
  out.push(...structuralStrategies());
  out.push(...famousStrategies());
  out.push(...binaryStrategies());
  return out.map((spec) => ({
    ...spec,
    id: spec.id.includes(":ctx2")
      ? spec.id
      : spec.id.replace(/:(seguir|reverter)$/, ":ctx2:$1"),
    signal: (s, i) => {
      const d = spec.signal(s, i);
      if (!d || !regimeAllows(spec.family, s, i)) return 0;
      // A divergence is a turn at a new extreme, so it cannot wait for a range edge;
      // it only must not fight a confirmed trend.
      if (spec.family === "divergencia") {
        const t = priceContext(s, i).trend;
        return !t || t === d ? d : 0;
      }
      return contextAllows(s, i, d) ? d : 0;
    },
  }));
}
// What each indicator is for: trend tools only work when there is a trend (ADX >= 20),
// oscillators and reversal setups only when the market is not trending hard (ADX < 25).
export const TREND_FAMILIES = new Set([
  "supertrend",
  "utbot",
  "macd",
  "ichimoku",
  "adx",
  "donchian",
  "psar",
  "heikin-ashi",
  "pullback",
  "confluencia",
  "impulso",
  "sr-rompimento",
  "vela-forca",
  "squeeze",
  "sequencia",
  "fluxo",
]);
export const regimeOf = (family: string) =>
  TREND_FAMILIES.has(family) ? "tendencia" : "reversao";
// Structural setups already read the regime from price itself (trend lines, range edges).
const OWN_REGIME = new Set(["lateral", "estrutura", "fibonacci"]);
export function regimeAllows(family: string, s: Series, i: number) {
  if (OWN_REGIME.has(family)) return true;
  const adx = adxAt(s, i);
  if (!Number.isFinite(adx)) return false;
  return TREND_FAMILIES.has(family) ? adx >= 20 : adx < 25;
}
// One-sided Wilson lower bound of the win rate.
export function wilson(wins: number, n: number, z: number) {
  if (!n) return null;
  const p = wins / n,
    d = 1 + (z * z) / n;
  return (
    (p +
      (z * z) / (2 * n) -
      z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) /
    d
  );
}
export function tally(
  wins: number,
  losses: number,
  ties: number,
  z: number,
): Tally {
  const n = wins + losses;
  return {
    trades: n + ties,
    wins,
    losses,
    ties,
    winRate: n ? wins / n : null,
    lower: wilson(wins, n, z),
  };
}
// OHLC research approximation: close-to-close return with a neutral threshold.
// It does not model bid/ask fills or the live shared per-asset admission gate.
export function backtest(
  s: Series,
  spec: StrategySpec,
  h: number,
  from: number,
  to: number,
  cooldownBars: number,
  z: number,
  split?: number,
  returnThreshold = 0,
) {
  const w = [0, 0],
    l = [0, 0],
    e = [0, 0];
  let next = from;
  for (let i = Math.max(from, WARMUP); i < to - h; i++) {
    if (i < next) continue;
    if (s.t[i + h] - s.t[i] !== h * 60000) continue;
    const d = spec.signal(s, i);
    if (!d) continue;
    const r = (s.c[i + h] / s.c[i] - 1) * d,
      k = split !== undefined && i >= split ? 1 : 0;
    if (r > returnThreshold) w[k]++;
    else if (r < -returnThreshold) l[k]++;
    else e[k]++;
    next = i + Math.max(h, cooldownBars);
  }
  return {
    all: tally(w[0] + w[1], l[0] + l[1], e[0] + e[1], z),
    halves: [tally(w[0], l[0], e[0], z), tally(w[1], l[1], e[1], z)] as [
      Tally,
      Tally,
    ],
  };
}
export interface LabOptions {
  breakEven: number;
  cooldownBars: number;
  minTrades: number;
  z: number;
  inSampleShare: number;
  returnThreshold?: number;
}
// For each family: pick parameters on the in-sample slice, then judge once on the out-of-sample slice.
export function evaluateSymbol(
  symbol: string,
  s: Series,
  horizons: Horizon[],
  o: LabOptions,
  specs = catalog(),
): Evaluation[] {
  const n = s.c.length,
    split = Math.floor(WARMUP + (n - WARMUP) * o.inSampleShare),
    mid = Math.floor((split + n) / 2),
    out: Evaluation[] = [];
  const families = [...new Set(specs.map((x) => x.family))];
  for (const h of horizons)
    for (const family of families) {
      let best: { spec: StrategySpec; is: Tally } | undefined;
      for (const spec of specs.filter((x) => x.family === family)) {
        const is = backtest(
          s,
          spec,
          h,
          WARMUP,
          split,
          o.cooldownBars,
          o.z,
          undefined,
          o.returnThreshold,
        ).all;
        if (is.trades < Math.max(30, o.minTrades / 2)) continue;
        if (!best || (is.lower ?? 0) > (best.is.lower ?? 0))
          best = { spec, is };
      }
      if (!best) continue;
      const r = backtest(
          s,
          best.spec,
          h,
          split,
          n,
          o.cooldownBars,
          o.z,
          mid,
          o.returnThreshold,
        ),
        oos = r.all,
        wr = oos.winRate ?? 0;
      const reason =
        oos.wins + oos.losses < o.minTrades
          ? `POUCAS OPERAÇÕES FORA DA AMOSTRA (${oos.wins + oos.losses} < ${o.minTrades})`
          : (oos.lower ?? 0) <= o.breakEven
            ? wr > o.breakEven
              ? "ACIMA DO BREAK-EVEN, MAS SEM SIGNIFICÂNCIA ESTATÍSTICA"
              : "ABAIXO DO BREAK-EVEN FORA DA AMOSTRA"
            : r.halves.some((x) => (x.winRate ?? 0) <= o.breakEven)
              ? "INSTÁVEL: UMA METADE DO TESTE FICOU ABAIXO DO BREAK-EVEN"
              : "APROVADA";
      out.push({
        symbol,
        horizon: h,
        id: best.spec.id,
        family,
        label: best.spec.label,
        inSample: best.is,
        outOfSample: oos,
        halves: r.halves,
        approved: reason === "APROVADA",
        reason,
      });
    }
  return out.sort(
    (a, b) =>
      Number(b.approved) - Number(a.approved) ||
      (b.outOfSample.lower ?? 0) - (a.outOfSample.lower ?? 0),
  );
}
export function specById(id: string, specs = catalog()) {
  return specs.find((x) => x.id === id);
}
