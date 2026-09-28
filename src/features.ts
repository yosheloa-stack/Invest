import { technical, structure, mean, last, smooth } from "./indicators.js";
import type { Features, Horizon, MarketState, TF } from "./types.js";
export const FEATURE_VERSION = "market-v1";
export const FEATURE_NAMES = [
  "emaGapATR",
  "slopeATR",
  "rsi",
  "macdATR",
  "adx",
  "dmi",
  "atrPct",
  "bbWidth",
  "stoch",
  "vwapDistanceATR",
  "returnH",
  "acceleration",
  "relativeVolume",
  "candleBuyImbalance",
  "tradeImbalance",
  "bookImbalance",
  "spreadBps",
  "liquidityChange",
  "structure",
  "breakout",
  "retest",
  "rejection",
  "supportATR",
  "resistanceATR",
  "microTrend",
  "macroTrend",
  "newsDirection",
  "newsReaction",
  "newsAvailable",
  "superDirection",
  "newsHistoricalReturn",
  "newsHistoricalCount",
];
export interface NewsContext {
  direction: number;
  ids: string[];
  important: boolean;
  reaction: number;
  historicalReturn?: number;
  historicalCount?: number;
}
export function buildFeatures(
  s: MarketState,
  h: Horizon,
  at: number,
  news: NewsContext,
  newsAvailable: boolean,
): Features {
  if (
    !s.trade ||
    !s.quote ||
    !s.book ||
    s.trade.t > at ||
    s.trade.received > at ||
    s.quote.t > at ||
    s.book.t > at
  )
    throw Error("DADOS POSTERIORES À OBSERVAÇÃO");
  const tf: TF = h === 5 ? "1m" : "5m",
    macro: TF = h === 15 ? "1h" : "15m";
  const candles = s.candles[tf].filter((c) => c.end < at),
    microCandles = s.candles["1m"].filter((c) => c.end < at),
    macroCandles = s.candles[macro].filter((c) => c.end < at);
  const i = technical(candles),
    mi = technical(microCandles),
    ma = technical(macroCandles),
    pa = structure(candles.slice(-100));
  const c = last(candles),
    p = s.trade!.p,
    atr = Math.max(i.atr, p * 1e-10),
    prior = candles.slice(-21, -1),
    relativeVolume = c.v / (mean(prior.map((x) => x.v)) || 1),
    buyImbalance = c.v ? (2 * c.buy) / c.v - 1 : 0;
  const tr = s.trades.filter((x) => x.t <= at && x.t > at - 60000),
    buy = tr.filter((x) => x.buy).reduce((a, x) => a + x.q, 0),
    sell = tr.filter((x) => !x.buy).reduce((a, x) => a + x.q, 0),
    tradeImbalance = buy + sell ? (buy - sell) / (buy + sell) : 0;
  const series = microCandles.map((x) => x.c),
    returnH = last(series) / series[series.length - 1 - h] - 1,
    recentReturn = last(series) / series[series.length - 4] - 1,
    previousReturn = series[series.length - 4] / series[series.length - 7] - 1,
    acceleration = recentReturn - previousReturn;
  const ema = smooth(
      candles.map((x) => x.c),
      21,
    ),
    slope = (last(ema) - ema[ema.length - 4]) / atr,
    spread = ((s.quote!.ask - s.quote!.bid) / p) * 10000;
  const microTrend = Math.sign(mi.ema9 - mi.ema21),
    macroTrend = Math.sign(ma.ema50 - ma.ema200);
  const vector = [
    (i.ema9 - i.ema21) / atr,
    slope,
    i.rsi / 100,
    i.macdHist / atr,
    i.adx / 100,
    (i.plusDI - i.minusDI) / 100,
    i.atr / p,
    i.bbWidth,
    i.stochK / 100,
    (p - i.vwap) / atr,
    returnH,
    acceleration,
    relativeVolume,
    buyImbalance,
    tradeImbalance,
    s.book!.imbalance,
    spread,
    s.book!.change,
    pa.structure,
    pa.breakout,
    pa.retest,
    pa.rejection,
    (p - pa.support) / atr,
    (pa.resistance - p) / atr,
    microTrend,
    macroTrend,
    news.direction,
    news.reaction,
    newsAvailable ? 1 : 0,
    i.superDirection,
    news.historicalReturn ?? 0,
    Math.log1p(news.historicalCount ?? 0),
  ];
  if (vector.some((x) => !Number.isFinite(x))) throw Error("FEATURE INVÁLIDA");
  const trend = Math.sign(i.ema21 - i.ema50),
    momentum = Math.sign(i.macdHist) * (i.rsi > 55 || i.rsi < 45 ? 1 : 0),
    volume = relativeVolume >= 1 ? Math.sign(buyImbalance) : 0,
    flow =
      Math.sign(tradeImbalance) *
      (Math.sign(tradeImbalance) === Math.sign(s.book!.imbalance) ? 1 : 0);
  const old = technical(candles.slice(0, -1)),
    cross =
      Math.sign(i.ema9 - i.ema21) !== Math.sign(old.ema9 - old.ema21)
        ? Math.sign(i.ema9 - i.ema21)
        : 0;
  return {
    version: FEATURE_VERSION,
    symbol: s.symbol,
    horizon: h,
    t: at,
    price: p,
    vector,
    names: FEATURE_NAMES,
    indicators: i,
    groups: {
      trend,
      momentum,
      structure: pa.breakout || pa.retest || pa.structure,
      volume,
      flow,
      mtf: microTrend === macroTrend ? macroTrend : 0,
      news: Math.abs(news.direction) > 0.2 ? Math.sign(news.direction) : 0,
      reaction: news.reaction,
    },
    details: {
      ...pa,
      relativeVolume,
      tradeBuyVolume: buy,
      tradeSellVolume: sell,
      tradeImbalance,
      bookImbalance: s.book!.imbalance,
      bookLevels: 20,
      liquidityChange: s.book!.change,
      spreadBps: spread,
      atrPct: i.atr / p,
      bbExpansion: i.bbWidth > old.bbWidth,
      emaCross: cross,
      emaSlopeATR: slope,
      emaDistanceATR: (i.ema9 - i.ema21) / atr,
      momentumAcceleration: acceleration,
      returnH,
      pullback: trend !== 0 && Math.abs(c.c - i.ema21) < atr * 0.5,
      consolidation: i.adx < 20,
      potentialReversal:
        pa.falseBreakout !== 0 && Math.sign(pa.falseBreakout) !== trend,
      continuation: pa.structure === trend && trend !== 0,
      volumeDivergence: Math.sign(c.c - c.o) !== Math.sign(buyImbalance),
      micro: microTrend,
      macro: macroTrend,
      localTimeframe: tf,
      macroTimeframe: macro,
      importantNews: news.important,
      newsHistoricalCount: news.historicalCount ?? 0,
      newsHistoricalReturn: news.historicalReturn ?? 0,
    },
    newsIds: news.ids,
  };
}
