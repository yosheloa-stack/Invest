import { config } from "./config.js";
import { log } from "./log.js";
import type { SQLiteConnection } from "./database.js";
import type { StrategyLab } from "./lab.js";
import type { Candle } from "./types.js";
import { RobotAI } from "./robot-ai.js";
import {
  liveKey,
  newTrade,
  readMarket,
  robotStats,
  settleTrade,
  type MarketRead,
  type RobotTrade,
} from "./robot.js";
type PriceOf = (symbol: string) => { p: number; t: number } | null;
// Runs the simulated operator: one open trade per asset, settles at expiry from the live price.
export class Robot {
  enabled = config.ROBOT_ENABLED;
  trades: RobotTrade[] = [];
  reads = new Map<string, MarketRead>();
  status = "AGUARDANDO HISTÓRICO DO LABORATÓRIO";
  ai = new RobotAI(
    config.ANTHROPIC_API_KEY,
    config.ROBOT_AI_MODEL,
    config.ROBOT_AI_MAX_PER_HOUR,
  );
  private seen = new Map<string, number>();
  private busy = new Set<string>();
  constructor(
    private db: SQLiteConnection,
    private lab: StrategyLab,
  ) {}
  get breakEven() {
    return 1 / (1 + config.PAYOUT);
  }
  private options() {
    return {
      breakEven: this.breakEven,
      minTrades: config.ROBOT_MIN_TRADES,
      minScore: Math.max(config.ROBOT_MIN_WINRATE, this.breakEven),
    };
  }
  load(now: number) {
    this.trades = this.db
      .query("SELECT body FROM robot_trades ORDER BY opened_at DESC LIMIT 3000")
      .rows.map((r) =>
        typeof r.body === "string" ? JSON.parse(r.body) : r.body,
      );
    for (const t of this.trades)
      if (t.status === "ABERTA" && now > t.due + 60000)
        this.save({
          ...t,
          status: "CANCELADA",
          note: "App reiniciou durante a operação",
        });
  }
  private save(t: RobotTrade) {
    this.db.query(
      "INSERT INTO robot_trades(id,symbol,opened_at,status,body) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status, body=EXCLUDED.body",
      [t.id, t.symbol, t.openedAt, t.status, JSON.stringify(t)],
    );
    this.trades = [t, ...this.trades.filter((x) => x.id !== t.id)].slice(
      0,
      3000,
    );
  }
  private live() {
    const m = new Map<string, { wins: number; trades: number }>();
    for (const t of this.trades) {
      if (t.status !== "FECHADA" || t.result === "EMPATE") continue;
      const k = liveKey(t.strategyId, t.symbol, t.horizon),
        r = m.get(k) ?? { wins: 0, trades: 0 };
      r.trades++;
      if (t.result === "WIN") r.wins++;
      m.set(k, r);
    }
    return m;
  }
  get open() {
    return this.trades.filter((t) => t.status === "ABERTA");
  }
  read(symbol: string, closed: Candle[]) {
    return readMarket(
      symbol,
      closed,
      this.lab.evaluations,
      this.live(),
      this.options(),
    );
  }
  // Called every second: closes trades whose expiry has passed.
  settle(now: number, priceOf: PriceOf) {
    let changed = false;
    for (const t of this.open) {
      if (now < t.due) continue;
      const q = priceOf(t.symbol);
      if (q && q.t >= t.due && q.t - t.due <= 5000) {
        this.save(settleTrade(t, q.p, q.t));
        changed = true;
      } else if (now > t.due + 60000) {
        this.save({
          ...t,
          status: "CANCELADA",
          note: "Sem cotação no vencimento",
        });
        changed = true;
      }
    }
    return changed;
  }
  // Called once per closed 1m candle of each asset.
  onCandle(symbol: string, closed: Candle[], priceOf: PriceOf, now: number) {
    const last = closed[closed.length - 1];
    if (!last || last.t <= (this.seen.get(symbol) ?? 0)) return;
    this.seen.set(symbol, last.t);
    if (!this.lab.evaluations.length) {
      this.status = `AGUARDANDO LABORATÓRIO: ${this.lab.status}`;
      return;
    }
    const read = this.read(symbol, closed);
    if (!read) return;
    this.reads.set(symbol, read);
    this.status = this.enabled
      ? this.open.length
        ? `OPERANDO (${this.open.length} ABERTA${this.open.length > 1 ? "S" : ""})`
        : "PROCURANDO OPORTUNIDADE"
      : "PAUSADO";
    const pick = read.pick;
    if (
      !this.enabled ||
      !pick ||
      this.busy.has(symbol) ||
      this.open.some((t) => t.symbol === symbol) ||
      this.open.length >= config.ROBOT_MAX_OPEN
    )
      return;
    const lastOnSymbol = this.trades.find((t) => t.symbol === symbol);
    if (
      lastOnSymbol &&
      now < lastOnSymbol.openedAt + lastOnSymbol.horizon * 60000
    )
      return;
    this.busy.add(symbol);
    void (async () => {
      try {
        const review = await this.ai.review(read, pick, closed);
        if (review && !review.enter) {
          this.reads.set(symbol, {
            ...read,
            why: `IA vetou a entrada: ${review.reason}`,
            lines: [...read.lines, `IA vetou: ${review.reason}`],
          });
          return;
        }
        const q = priceOf(symbol),
          at = Date.now();
        // The opportunity is only valid right after the candle closed.
        if (!q || at - last.end > 30000 || at - q.t > config.STALE_MS) return;
        if (this.open.some((t) => t.symbol === symbol)) return;
        this.save(
          newTrade(
            read,
            pick,
            q.p,
            at,
            config.ROBOT_STAKE,
            config.PAYOUT,
            review
              ? {
                  model: this.ai.model,
                  confidence: review.confidence,
                  reason: review.reason,
                }
              : null,
          ),
        );
      } catch (e) {
        log.error({ err: e }, "robô");
      } finally {
        this.busy.delete(symbol);
      }
    })();
  }
  brief() {
    return {
      enabled: this.enabled,
      status: this.status,
      stats: robotStats(this.trades, config.ROBOT_BANKROLL),
      open: this.open,
      last: this.trades.filter((t) => t.status !== "ABERTA").slice(0, 5),
    };
  }
  summary() {
    return {
      ...this.brief(),
      breakEven: this.breakEven,
      minScore: this.options().minScore,
      minTrades: config.ROBOT_MIN_TRADES,
      stake: config.ROBOT_STAKE,
      payout: config.PAYOUT,
      maxOpen: config.ROBOT_MAX_OPEN,
      ai: {
        enabled: this.ai.enabled,
        model: this.ai.enabled ? this.ai.model : null,
        usedLastHour: this.ai.usedLastHour,
        maxPerHour: this.ai.budget,
        lastError: this.ai.lastError,
      },
      trades: this.trades.slice(0, 200),
      reads: [...this.reads.values()].map(({ fired, ...r }) => ({
        ...r,
        fired: fired.slice(0, 5),
      })),
    };
  }
}
