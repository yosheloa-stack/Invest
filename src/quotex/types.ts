export interface QuotexConfig {
  email: string;
  password: string;
  ssid?: string;
  host: string;
  isDemo: boolean;
  /** Minimum payout ratio to consider an asset (0.80 = 80%) */
  minPayout: number;
  /** Fixed expiration in seconds (300 = 5 min) */
  expiration: number;
  /** Starting balance for bankroll tracking */
  startBalance: number;
  /** Target balance to stop at */
  targetBalance: number;
  /** Maximum fraction of balance per trade (0.05 = 5%) */
  maxStakePct: number;
  /** Minimum stake in account currency */
  minStake: number;
  /** Minimum number of confirming signals to enter */
  minConfluence: number;
  /** Cooldown between trades on the same asset (ms) */
  cooldownMs: number;
  /** Maximum consecutive losses before pausing */
  maxConsecLosses: number;
  /** Daily loss limit as fraction of starting balance */
  dailyLossLimit: number;
}

export const DEFAULT_CONFIG: Omit<QuotexConfig, "email" | "password"> = {
  host: "qxbroker.com",
  isDemo: true,
  minPayout: 0.80,
  expiration: 300,
  startBalance: 60,
  targetBalance: 600,
  maxStakePct: 0.05,
  minStake: 1,
  minConfluence: 3,
  cooldownMs: 300_000,
  maxConsecLosses: 3,
  dailyLossLimit: 0.30,
};

export type Direction = "call" | "put";

export interface Asset {
  id: number;
  name: string;
  payout: number;
  isOpen: boolean;
  isSuspended: boolean;
}

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

export interface TradeOrder {
  asset: string;
  assetId: number;
  direction: Direction;
  amount: number;
  expiration: number;
  isDemo: boolean;
}

export interface TradeResult {
  id: string;
  asset: string;
  direction: Direction;
  amount: number;
  openPrice: number;
  closePrice: number;
  profit: number;
  win: boolean;
  openedAt: number;
  closedAt: number;
}

export interface Signal {
  asset: string;
  assetId: number;
  direction: Direction;
  confidence: number;
  reasons: string[];
  timestamp: number;
}

export type BotStatus =
  | "connecting"
  | "scanning"
  | "analyzing"
  | "waiting"
  | "trading"
  | "paused"
  | "stopped"
  | "target_reached";
