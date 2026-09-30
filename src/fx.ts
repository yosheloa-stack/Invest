import type { Candle } from "./types.js";
// Forex from Yahoo Finance's public chart endpoint (no key). Forex has no traded
// volume, so every bar carries a neutral volume of 1 with half of it on each side.
type Chart = {
  chart?: {
    result?:
      | {
          meta?: { regularMarketPrice?: number; regularMarketTime?: number };
          timestamp?: number[];
          indicators?: {
            quote?: {
              open?: (number | null)[];
              high?: (number | null)[];
              low?: (number | null)[];
              close?: (number | null)[];
            }[];
          };
        }[]
      | null;
    error?: { description?: string } | null;
  };
};
const HOSTS = [
  "https://query1.finance.yahoo.com",
  "https://query2.finance.yahoo.com",
];
// Our names for commodities and indices, as Yahoo lists them (futures or cash index).
const YAHOO: Record<string, string> = {
  XAUUSD: "GC=F",
  XAGUSD: "SI=F",
  USOIL: "CL=F",
  UKOIL: "BZ=F",
  US100: "NQ=F",
  US500: "ES=F",
  US30: "YM=F",
  GER40: "^GDAXI",
  UK100: "^FTSE",
  JP225: "^N225",
};
export const yahooSymbol = (symbol: string) =>
  YAHOO[symbol] ?? (/^[A-Z]{6}$/.test(symbol) ? `${symbol}=X` : symbol);
export async function yahooChart(
  symbol: string,
  interval: "1m" | "5m" | "15m" | "1h",
  from: number,
  to: number,
) {
  const q = `/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}?interval=${interval}&period1=${Math.floor(from / 1000)}&period2=${Math.ceil(to / 1000)}&includePrePost=false`;
  let last: unknown;
  for (const host of HOSTS) {
    try {
      const r = await fetch(host + q, {
        headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw Error(`Yahoo HTTP ${r.status}`);
      const body = (await r.json()) as Chart,
        res = body.chart?.result?.[0];
      if (!res)
        throw Error(body.chart?.error?.description || "Yahoo sem dados");
      return parse(res, interval);
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : Error(String(last));
}
const MS = { "1m": 60000, "5m": 300000, "15m": 900000, "1h": 3600000 };
function parse(
  res: NonNullable<NonNullable<Chart["chart"]>["result"]>[number],
  interval: keyof typeof MS,
) {
  const ms = MS[interval],
    t = res.timestamp || [],
    q = res.indicators?.quote?.[0] || {},
    bars = new Map<number, Candle>();
  t.forEach((sec, i) => {
    const o = q.open?.[i],
      h = q.high?.[i],
      l = q.low?.[i],
      c = q.close?.[i];
    if ([o, h, l, c].some((x) => x == null || !Number.isFinite(x) || x <= 0))
      return;
    const start = Math.floor((sec * 1000) / ms) * ms;
    bars.set(start, {
      t: start,
      end: start + ms - 1,
      o: o!,
      h: Math.max(h!, o!, c!),
      l: Math.min(l!, o!, c!),
      c: c!,
      v: 1,
      buy: 0.5,
      quote: 0,
    });
  });
  return {
    price:
      res.meta?.regularMarketPrice && res.meta.regularMarketPrice > 0
        ? res.meta.regularMarketPrice
        : null,
    bars: [...bars.values()].sort((a, b) => a.t - b.t),
  };
}
// Forex quotes skip quiet minutes and the weekend; indicators need a continuous
// series, so missing bars repeat the previous close as a flat candle.
export function fillGaps(cs: Candle[], ms: number): Candle[] {
  const out: Candle[] = [];
  for (const c of cs) {
    const prev = out[out.length - 1];
    if (prev && c.t <= prev.t) continue;
    if (prev)
      for (let t = prev.t + ms; t < c.t; t += ms)
        out.push({
          t,
          end: t + ms - 1,
          o: prev.c,
          h: prev.c,
          l: prev.c,
          c: prev.c,
          v: 1,
          buy: 0.5,
          quote: 0,
        });
    out.push(c);
  }
  return out;
}
// Groups 1m bars into one higher-timeframe bar.
export function combine(bars: Candle[], t: number, ms: number): Candle | null {
  if (!bars.length) return null;
  return {
    t,
    end: t + ms - 1,
    o: bars[0].o,
    h: Math.max(...bars.map((b) => b.h)),
    l: Math.min(...bars.map((b) => b.l)),
    c: bars[bars.length - 1].c,
    v: bars.length,
    buy: bars.length / 2,
    quote: 0,
  };
}
// Up to 30 days of 1m history; Yahoo serves 1m data in windows of at most 7 days.
export async function yahooHistory(symbol: string, from: number, now: number) {
  const start = Math.max(from, now - 29.5 * 86400000),
    out: Candle[] = [];
  for (let a = start; a < now; a += 7 * 86400000) {
    const { bars } = await yahooChart(
      symbol,
      "1m",
      a,
      Math.min(now, a + 7 * 86400000),
    );
    out.push(...bars);
  }
  const closed = [...new Map(out.map((c) => [c.t, c])).values()]
    .filter((c) => c.end < now)
    .sort((a, b) => a.t - b.t);
  return fillGaps(closed, 60000);
}
