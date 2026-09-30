export type Horizon = 1 | 5 | 10 | 15;
// Expiries of the forecast/signal pipeline.
export const HORIZONS: Horizon[] = [5, 10, 15];
// Expiries the strategy lab and the robot test; Ebinex offers M1, M5 and M15.
export const STRATEGY_HORIZONS: Horizon[] = [5, 10, 15];
export const ROBOT_DEFAULT_HORIZONS: Horizon[] = [5, 10, 15];
export type TF = "1m" | "5m" | "15m" | "1h";
export const INTERVALS: Record<TF, number> = {
  "1m": 60000,
  "5m": 300000,
  "15m": 900000,
  "1h": 3600000,
};
export interface Candle {
  t: number;
  end: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  buy: number;
  quote: number;
}
export interface Trade {
  id: number;
  t: number;
  received: number;
  p: number;
  q: number;
  buy: boolean;
}
export interface Quote {
  updateId?: number;
  t: number;
  bid: number;
  ask: number;
}
export interface MarketState {
  symbol: string;
  connected: boolean;
  ready: boolean;
  error: string | null;
  connectedAt: number;
  trade?: Trade;
  forming?: Candle;
  formingAt?: number;
  quote?: Quote;
  book?: {
    t: number;
    id: number;
    bidQty: number;
    askQty: number;
    imbalance: number;
    change: number;
  };
  trades: Trade[];
  candles: Record<TF, Candle[]>;
  lastKline: Partial<Record<TF, number>>;
}
export interface Indicators {
  ema9: number;
  ema21: number;
  ema50: number;
  ema200: number;
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  adx: number;
  plusDI: number;
  minusDI: number;
  atr: number;
  vwap: number;
  bbUpper: number;
  bbLower: number;
  bbMiddle: number;
  bbWidth: number;
  stochK: number;
  stochD: number;
  supertrend: number;
  superDirection: number;
}
export interface Features {
  version: string;
  symbol: string;
  horizon: Horizon;
  t: number;
  price: number;
  vector: number[];
  names: string[];
  indicators: Indicators;
  groups: Record<string, number>;
  details: Record<string, number | string | boolean>;
  newsIds: string[];
}
export interface Decision {
  horizon: Horizon;
  state: "COMPRA" | "VENDA" | "SEM ENTRADA" | "ANÁLISE INDISPONÍVEL";
  reason: string;
  probability: number | null;
  probabilities?: number[];
  score?: number;
  favorable: string[];
  contrary: string[];
  signal?: Signal;
}
export interface Signal {
  id: string;
  symbol: string;
  t: number;
  horizon: Horizon;
  direction: "COMPRA" | "VENDA";
  analyzedPrice: number;
  entryLow: number;
  entryHigh: number;
  expires: number;
  probability: number;
  modelId: string;
  features: Features;
  score: number;
  favorable: string[];
  contrary: string[];
  status:
    | "PENDING"
    | "FILLED"
    | "INVALIDATED"
    | "EXPIRED"
    | "SETTLED"
    | "NO_DATA";
  entry?: number;
  entryAt?: number;
  due?: number;
  exit?: number;
  exitAt?: number;
  result?: "WIN" | "LOSS" | "NEUTRO";
  return?: number;
  reason?: string;
}
export interface NewsClassification {
  assets: string[];
  sentiment: "positive" | "negative" | "neutral" | "mixed";
  impact_score: number;
  relevance: number;
  confidence: number;
  expected_horizon: "immediate" | "short_term" | "medium_term" | "long_term";
  event_type: string;
  summary: string;
  reasoning_summary: string;
}
export interface NewsEvent {
  id: string;
  title: string;
  content: string;
  source: string;
  url: string;
  publishedAt: number;
  receivedAt: number;
  availableAt: number | null;
  classification: NewsClassification | null;
  embedding: number[] | null;
  fingerprint: string;
  error?: string;
}
export interface Snapshot {
  symbol: string;
  t: number;
  eventT: number;
  quoteT: number;
  price: number;
  bid: number;
  ask: number;
  volume: number;
  volatility: number;
}
