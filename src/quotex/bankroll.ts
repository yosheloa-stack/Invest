import type { QuotexConfig } from "./types.js";

export interface BankrollState {
  balance: number;
  startBalance: number;
  targetBalance: number;
  wins: number;
  losses: number;
  streak: number; // positive = winning streak, negative = losing
  todayPnl: number;
  todayTradeCount: number;
  dayStart: number;
  paused: boolean;
  pauseReason: string | null;
}

export function newBankrollState(config: QuotexConfig): BankrollState {
  return {
    balance: config.startBalance,
    startBalance: config.startBalance,
    targetBalance: config.targetBalance,
    wins: 0,
    losses: 0,
    streak: 0,
    todayPnl: 0,
    todayTradeCount: 0,
    dayStart: todayStart(),
    paused: false,
    pauseReason: null,
  };
}

function todayStart(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function updateBalance(state: BankrollState, profit: number, win: boolean): BankrollState {
  const s = { ...state };

  // Reset daily counters if new day
  const today = todayStart();
  if (today > s.dayStart) {
    s.todayPnl = 0;
    s.todayTradeCount = 0;
    s.dayStart = today;
    s.paused = false;
    s.pauseReason = null;
  }

  s.balance += profit;
  s.todayPnl += profit;
  s.todayTradeCount++;

  if (win) {
    s.wins++;
    s.streak = s.streak > 0 ? s.streak + 1 : 1;
  } else {
    s.losses++;
    s.streak = s.streak < 0 ? s.streak - 1 : -1;
  }

  return s;
}

export function calculateStake(state: BankrollState, config: QuotexConfig): number {
  if (state.paused) return 0;

  // Base stake: percentage of current balance
  let stake = Math.floor(state.balance * config.maxStakePct * 100) / 100;

  // Anti-martingale: reduce after losses
  if (state.streak < 0) {
    const factor = Math.max(0.5, 1 - Math.abs(state.streak) * 0.15);
    stake *= factor;
  }

  // Slightly increase after wins (conservative)
  if (state.streak > 2) {
    stake *= Math.min(1.3, 1 + state.streak * 0.05);
  }

  // Clamp
  stake = Math.max(config.minStake, Math.round(stake * 100) / 100);
  stake = Math.min(stake, state.balance * 0.1); // never risk more than 10%

  return stake;
}

export function shouldTrade(state: BankrollState, config: QuotexConfig): { ok: boolean; reason?: string } {
  // Target reached
  if (state.balance >= config.targetBalance) {
    return { ok: false, reason: `meta atingida: R$${state.balance.toFixed(2)}` };
  }

  // Busted
  if (state.balance < config.minStake) {
    return { ok: false, reason: `saldo insuficiente: R$${state.balance.toFixed(2)}` };
  }

  // Daily loss limit
  const maxDailyLoss = config.startBalance * config.dailyLossLimit;
  if (state.todayPnl < -maxDailyLoss) {
    return {
      ok: false,
      reason: `limite diario atingido: R$${state.todayPnl.toFixed(2)} (max -R$${maxDailyLoss.toFixed(2)})`,
    };
  }

  // Consecutive losses
  if (state.streak <= -config.maxConsecLosses) {
    return {
      ok: false,
      reason: `${Math.abs(state.streak)} derrotas consecutivas — pausando`,
    };
  }

  if (state.paused) {
    return { ok: false, reason: state.pauseReason || "pausado" };
  }

  return { ok: true };
}
