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
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function getJson<T>(url: string): Promise<T> {
  for (let n = 0; ; n++) {
    try {
      await pause(120);
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw Error(`HTTP ${r.status}`);
      return (await r.json()) as T;
    } catch (e) {
      if (n === 3) throw e;
      await pause(1000 * 2 ** n);
    }
  }
}
// Bybit/OKX do not publish taker-buy volume per candle; it is set to half the volume,
// so the order-flow strategy family simply never fires on these sources.
function candle(
  t: number,
  o: string,
  h: string,
  l: string,
  c: string,
  v: string,
): Candle {
  return {
    t,
    end: t + 59999,
    o: +o,
    h: +h,
    l: +l,
    c: +c,
    v: +v,
    buy: +v / 2,
    quote: +v * +c,
  };
}
async function bybit(symbol: string, start: number, now: number) {
  const out: Candle[] = [];
  for (let s = start; s < now - 60000; s += 1000 * 60000) {
    const r = await getJson<{ retCode: number; result: { list: string[][] } }>(
      `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=1&limit=1000&start=${s}&end=${s + 999 * 60000}`,
    );
    if (r.retCode !== 0) throw Error(`retCode ${r.retCode}`);
    for (const x of r.result.list)
      out.push(candle(+x[0], x[1], x[2], x[3], x[4], x[5]));
  }
  return out;
}
async function okx(symbol: string, start: number, now: number) {
  const out: Candle[] = [],
    inst = symbol.replace(/USDT$/, "-USDT");
  let after = now;
  while (after > start) {
    const r = await getJson<{ code: string; data: string[][] }>(
      `https://www.okx.com/api/v5/market/history-candles?instId=${inst}&bar=1m&limit=100&after=${after}`,
    );
    if (r.code !== "0") throw Error(`code ${r.code}`);
    if (!r.data.length) break;
    for (const x of r.data)
      if (x[8] === "1" && +x[0] >= start)
        out.push(candle(+x[0], x[1], x[2], x[3], x[4], x[5]));
    after = +r.data[r.data.length - 1][0];
  }
  return out;
}
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
  sources: Record<string, string> = {};
  // Tries Binance first, then Bybit and OKX; any liquid exchange tracks the same market price.
  private async fetch(symbol: string) {
    const now = this.rest.now(),
      from = now - config.STRATEGY_DAYS * 86400000,
      errors: string[] = [];
    for (const [name, load] of [
      ["Binance", this.binance],
      ["Bybit", bybit],
      ["OKX", okx],
    ] as const) {
      try {
        const kept =
          this.sources[symbol] === name
            ? (this.history.get(symbol) || []).filter((c) => c.t >= from)
            : [];
        const since = kept.length ? kept[kept.length - 1].t + 60000 : from;
        const fresh = await load.call(this, symbol, since, now);
        const cs = [
          ...new Map(
            [...kept, ...fresh]
              .filter(
                (c) =>
                  c.end < now &&
                  Object.values(c).every(Number.isFinite) &&
                  c.c > 0,
              )
              .map((c) => [c.t, c]),
          ).values(),
        ].sort((a, b) => a.t - b.t);
        if (cs.length < config.STRATEGY_DAYS * 1440 * 0.8)
          throw Error(`só ${cs.length} candles`);
        this.history.set(symbol, cs);
        this.sources[symbol] = name;
        return cs;
      } catch (e) {
        errors.push(`${name}: ${e instanceof Error ? e.message : e}`);
        log.warn({ symbol, source: name, err: e }, "fonte de histórico falhou");
      }
    }
    throw Error(`HISTÓRICO INDISPONÍVEL PARA ${symbol} (${errors.join("; ")})`);
  }
  private async binance(symbol: string, start: number, now: number) {
    const out: Candle[] = [];
    while (start < now - 60000) {
      const raw = await this.rest.get<unknown[][]>(
        `/api/v3/klines?symbol=${symbol}&interval=1m&limit=1000&startTime=${start}`,
      );
      if (!Array.isArray(raw) || !raw.length) break;
      for (const x of raw)
        out.push({
          t: +x[0]!,
          o: +x[1]!,
          h: +x[2]!,
          l: +x[3]!,
          c: +x[4]!,
          v: +x[5]!,
          end: +x[6]!,
          quote: +x[7]!,
          buy: +x[9]!,
        });
      start = Number(raw[raw.length - 1][0]) + 60000;
      if (raw.length < 1000) break;
    }
    return out;
  }
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      this.status = this.evaluations.length
        ? "REVALIDANDO COM DADOS NOVOS"
        : "BAIXANDO HISTÓRICO REAL DE 1 MINUTO";
      const all: Evaluation[] = [];
      let from = Infinity,
        to = 0;
      for (const symbol of symbols) {
        const cs = await this.fetch(symbol);
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
  // Where the best-ranked strategies of this asset fired over the recent candles (chart markers).
  triggers(symbol: string, closed: Candle[], window = 240, top = 2) {
    const ranked = this.evaluations
      .filter((x) => x.symbol === symbol && x.horizon === 5)
      .slice(0, top);
    if (!ranked.length || closed.length < 400) return [];
    const s = buildSeries(closed.slice(-1500)),
      out: {
        t: number;
        direction: "COMPRA" | "VENDA";
        label: string;
        approved: boolean;
        winRate: number | null;
      }[] = [];
    for (const e of ranked) {
      const spec = this.specs.get(e.id);
      if (!spec) continue;
      for (let i = Math.max(1, s.c.length - window); i < s.c.length; i++) {
        const d = spec.signal(s, i);
        if (d)
          out.push({
            t: s.t[i],
            direction: d === 1 ? "COMPRA" : "VENDA",
            label: e.label,
            approved: e.approved,
            winRate: e.outOfSample.winRate,
          });
      }
    }
    return out;
  }
  brief() {
    const { evaluations, ...rest } = this.summary();
    return {
      ...rest,
      approvedList: evaluations
        .filter((x) => x.approved)
        .map((x) => ({
          symbol: x.symbol,
          horizon: x.horizon,
          label: x.label,
          winRate: x.outOfSample.winRate,
        })),
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
      sources: this.sources,
      tested: this.evaluations.length,
      approved: this.evaluations.filter((x) => x.approved).length,
      evaluations: this.evaluations,
    };
  }
}
