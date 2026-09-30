export type Signal = {
  id: string;
  symbol: string;
  t: number;
  horizon: number;
  direction: "COMPRA" | "VENDA";
  status: string;
  entryLow: number;
  entryHigh: number;
  expires: number;
  probability: number;
  analyzedPrice: number;
  entry?: number;
  entryAt?: number;
  due?: number;
  exit?: number;
  exitAt?: number;
  result?: "WIN" | "LOSS" | "NEUTRO";
  return?: number;
  reason?: string;
  modelId: string;
  favorable: string[];
};
export type Forecast = {
  horizon: number;
  state: string;
  reason: string;
  probability: number | null;
  favorable: string[];
  contrary: string[];
  signal?: Signal;
};
export type Asset = {
  symbol: string;
  price: number | null;
  change: number | null;
  feed: string;
  reasons: string[];
  eventTime: number | null;
  chart: { t: number; p: number }[];
  indicators: Record<string, number> | null;
  features: Record<string, number | string | boolean> | null;
  groups: Record<string, number> | null;
  forecasts: Forecast[];
};
export type Metric = {
  count: number;
  wins: number;
  losses: number;
  neutrals: number;
  winRate: number | null;
  maxLossStreak: number;
  paperUnits: number;
};
export type News = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: number;
  availableAt: number | null;
  classification: null | {
    assets: string[];
    sentiment: string;
    impact_score: number;
    confidence: number;
    event_type: string;
    summary: string;
    reasoning_summary: string;
  };
  reactions: {
    symbol: string;
    horizon: number;
    return: number | null;
    status: string;
  }[];
};
export type Tally = {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  lower: number | null;
};
export type Evaluation = {
  symbol: string;
  horizon: number;
  id: string;
  label: string;
  inSample: Tally;
  outOfSample: Tally;
  halves: [Tally, Tally];
  approved: boolean;
  reason: string;
};
export type LabBrief = {
  status: string;
  error: string | null;
  updatedAt: number | null;
  historyFrom: number | null;
  historyTo: number | null;
  breakEven: number;
  payout: number;
  minTrades: number;
  sources?: Record<string, string>;
  tested: number;
  approved: number;
  approvedList: {
    symbol: string;
    horizon: number;
    label: string;
    winRate: number | null;
  }[];
};
export type Lab = Omit<LabBrief, "approvedList"> & {
  evaluations: Evaluation[];
};
export type Metrics = Metric & {
  total: number;
  pending: number;
  noData: number;
  invalidated: number;
  payout: number;
  breakEven: number;
  byAsset: Record<string, Metric>;
  byHorizon: Record<string, Metric>;
  byHour: Record<string, Metric>;
  byStrategy: Record<string, Metric>;
  byNews: Record<string, Metric>;
  calibration: {
    from: number;
    to: number;
    count: number;
    predicted: number | null;
    observed: number | null;
  }[];
  observations: { status: string; count: number }[];
};
export type State = {
  time: number;
  mode: string;
  database: string;
  newsStatus: string;
  newsCapabilities: { semanticDedup: string; classification: string };
  assets: Asset[];
  metrics: Metrics | null;
  signals: Signal[];
  news: News[];
  models: { id: string; symbol: string; horizon: number }[];
  strategies?: LabBrief;
  robot?: RobotBrief | null;
};
export type RobotTrade = {
  id: string;
  symbol: string;
  horizon: number;
  direction: "COMPRA" | "VENDA";
  strategy: string;
  score: number;
  backtestWinRate: number | null;
  openedAt: number;
  entry: number;
  due: number;
  stake: number;
  payout: number;
  status: "ABERTA" | "FECHADA" | "CANCELADA";
  exit?: number;
  closedAt?: number;
  result?: "WIN" | "LOSS" | "EMPATE";
  profit?: number;
  note?: string;
  reading: string[];
  ai: { model: string; confidence: number; reason: string } | null;
};
export type RobotStats = {
  trades: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: number | null;
  profit: number;
  balance: number;
  bankroll: number;
  todayTrades: number;
  todayProfit: number;
  streak: number;
  byHorizon: {
    horizon: number;
    wins: number;
    losses: number;
    winRate: number | null;
  }[];
};
export type RobotBrief = {
  enabled: boolean;
  status: string;
  stats: RobotStats;
  open: RobotTrade[];
  last: RobotTrade[];
};
export type MarketRead = {
  symbol: string;
  t: number;
  price: number;
  trend: "ALTA" | "BAIXA" | "LATERAL";
  range: boolean;
  support: number | null;
  resistance: number | null;
  rsi: number | null;
  why: string;
  lines: string[];
  pick: {
    label: string;
    direction: "COMPRA" | "VENDA";
    horizon: number;
    score: number;
  } | null;
};
export type RobotSummary = RobotBrief & {
  breakEven: number;
  minScore: number;
  minTrades: number;
  stake: number;
  payout: number;
  maxOpen: number;
  ai: {
    enabled: boolean;
    model: string | null;
    usedLastHour: number;
    maxPerHour: number;
    lastError: string | null;
  };
  trades: RobotTrade[];
  reads: MarketRead[];
};
export type User = { id: string; email: string; name: string; role: string };
export type Trigger = {
  t: number;
  direction: "COMPRA" | "VENDA";
  label: string;
  approved: boolean;
  winRate: number | null;
};
export type CandleData = {
  symbol: string;
  candles: {
    t: number;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    buy?: number;
  }[];
  signals: Signal[];
  triggers: Trigger[];
};
