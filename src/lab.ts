import { config, symbols } from "./config.js";
import { log } from "./log.js";
import type { RestClient } from "./market.js";
import { HORIZONS, type Candle, type Horizon } from "./types.js";
import {
  buildSeries,
  catalog,
  evaluateSymbol,
  type Evaluation,
  type StrategySpec,
} from "./strategies.js";
const yieldLoop = () => new Promise((r) => setImmediate(r));
export interface StrategyPick {
  evaluation: Evaluation;
  direction: "COMPRA" | "VENDA";
}
// Downloads real 1m history, validates every strategy family and keeps only the approved ones.
export class StrategyLab {
  status = "AGUARDANDO HISTÓRICO";
  error: string | null = null;
  updatedAt = 0;
  historyFrom = 0;
  historyTo = 0;
  evaluations: Evaluation[] = [];
  private history = new Map<string, Candle[]>();
  private specs = new Map<string, StrategySpec>(
    catalog().map((x) => [x.id, x]),
  );
  private timer?: NodeJS.Timeout;
  private running = false;
  constructor(private rest: RestClient) {}
  get breakEven() {
    return 1 / (1 + config.PAYOUT);
  }
  start() {
    void this.run();
    this.timer = setInterval(
      () => void this.run(),
      config.STRATEGY_REFRESH_HOURS * 3600000,
    );
  }
  stop() {
    clearInterval(this.timer);
  }
  private async fetch(symbol: string) {
    const now = this.rest.now(),
      from = now - config.STRATEGY_DAYS * 86400000;
    let cs = (this.history.get(symbol) || []).filter((c) => c.t >= from);
    let start = cs.length ? cs[cs.length - 1].t + 60000 : from;
    while (start < now - 60000) {
      const raw = await this.rest.get<unknown[][]>(
        `/api/v3/klines?symbol=${symbol}&interval=1m&limit=1000&startTime=${start}`,
      );
      if (!Array.isArray(raw) || !raw.length) break;
      for (const x of raw) {
        const c: Candle = {
          t: +x[0]!,
          o: +x[1]!,
          h: +x[2]!,
          l: +x[3]!,
          c: +x[4]!,
          v: +x[5]!,
          end: +x[6]!,
          quote: +x[7]!,
          buy: +x[9]!,
        };
        if (c.end < now && Object.values(c).every(Number.isFinite) && c.c > 0)
          cs.push(c);
      }
      start = Number(raw[raw.length - 1][0]) + 60000;
      if (raw.length < 1000) break;
    }
    cs = [...new Map(cs.map((c) => [c.t, c])).values()].sort(
      (a, b) => a.t - b.t,
    );
    this.history.set(symbol, cs);
    return cs;
  }
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      this.status = this.evaluations.length
        ? "REVALIDANDO COM DADOS NOVOS"
        : "BAIXANDO HISTÓRICO REAL (BINANCE 1m)";
      const all: Evaluation[] = [];
      let from = Infinity,
        to = 0;
      for (const symbol of symbols) {
        const cs = await this.fetch(symbol);
        if (cs.length < 5000)
          throw Error(`HISTÓRICO INSUFICIENTE PARA ${symbol}`);
        from = Math.min(from, cs[0].t);
        to = Math.max(to, cs[cs.length - 1].end);
        this.status = `BACKTEST EM ANDAMENTO (${symbol})`;
        await yieldLoop();
        all.push(
          ...evaluateSymbol(symbol, buildSeries(cs), HORIZONS, {
            breakEven: this.breakEven,
            cooldownBars: Math.ceil(config.COOLDOWN_MS / 60000),
            minTrades: config.STRATEGY_MIN_TRADES,
            z: config.STRATEGY_Z,
            inSampleShare: 0.6,
          }),
        );
      }
      this.evaluations = all;
      this.historyFrom = from;
      this.historyTo = to;
      this.updatedAt = Date.now();
      this.error = null;
      const approved = all.filter((x) => x.approved).length;
      this.status = approved
        ? `${approved} ESTRATÉGIA(S) APROVADA(S) NO BACKTEST`
        : "NENHUMA ESTRATÉGIA SUPEROU O BREAK-EVEN COM SIGNIFICÂNCIA";
      log.info({ approved, tested: all.length }, "laboratório de estratégias");
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.status = "FALHA NO LABORATÓRIO — NOVA TENTATIVA EM 5 MIN";
      log.error({ err: e }, "strategy lab");
      setTimeout(() => void this.run(), 300000).unref();
    } finally {
      this.running = false;
    }
  }
  approved(symbol: string, h: Horizon) {
    return this.evaluations.filter(
      (x) => x.approved && x.symbol === symbol && x.horizon === h,
    );
  }
  // Evaluates approved strategies on the last closed candle; conflicting triggers cancel each other.
  decide(symbol: string, h: Horizon, closed: Candle[]): StrategyPick | null {
    const list = this.approved(symbol, h);
    if (!list.length || closed.length < 400) return null;
    const s = buildSeries(closed.slice(-1500)),
      i = s.c.length - 1;
    const fired = list
      .map((e) => ({ e, d: this.specs.get(e.id)?.signal(s, i) ?? 0 }))
      .filter((x) => x.d !== 0);
    if (!fired.length || fired.some((x) => x.d !== fired[0].d)) return null;
    return {
      evaluation: fired[0].e,
      direction: fired[0].d === 1 ? "COMPRA" : "VENDA",
    };
  }
  summary() {
    return {
      status: this.status,
      error: this.error,
      updatedAt: this.updatedAt || null,
      historyFrom: this.historyFrom || null,
      historyTo: this.historyTo || null,
      breakEven: this.breakEven,
      payout: config.PAYOUT,
      minTrades: config.STRATEGY_MIN_TRADES,
      z: config.STRATEGY_Z,
      tested: this.evaluations.length,
      approved: this.evaluations.filter((x) => x.approved).length,
      evaluations: this.evaluations,
    };
  }
}
