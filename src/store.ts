import { SQLiteConnection } from "./database.js";
import { readFile } from "node:fs/promises";
import { config } from "./config.js";
import type {
  Candle,
  Decision,
  Features,
  Horizon,
  NewsEvent,
  Signal,
  Snapshot,
  TF,
} from "./types.js";
import { randomUUID } from "node:crypto";
export class Store {
  pool: SQLiteConnection;
  healthy = false;
  constructor(path = config.SQLITE_PATH) {
    this.pool = new SQLiteConnection(path, () => {
      this.healthy = false;
    });
  }
  async init() {
    this.pool.acquireCollector();
    const version = Number(
      this.pool.query("PRAGMA user_version").rows[0]?.user_version || 0,
    );
    if (
      version === 0 &&
      this.pool.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      ).rowCount
    )
      throw Error(
        "Arquivo SQLite existente com schema desconhecido; preserve-o e use outro SQLITE_PATH",
      );
    if (version > 3) throw Error("Schema SQLite mais novo que esta aplicação");
    const migrations = [
      await readFile("migrations/001_initial.sql", "utf8"),
      await readFile("migrations/002_accounts.sql", "utf8"),
      await readFile("migrations/003_robot.sql", "utf8"),
    ];
    this.pool.transaction(() => migrations.forEach((m) => this.pool.exec(m)));
    this.healthy = true;
  }
  async ping() {
    this.pool.query("SELECT 1");
    this.healthy = true;
  }
  async candles(symbol: string, tf: TF, cs: Candle[]) {
    await this.pool.query(
      `INSERT INTO candles(symbol,tf,t,body) SELECT $1,$2,json_extract(value,'$.t'),value FROM json_each($3) WHERE 1 ON CONFLICT(symbol,tf,t) DO UPDATE SET body=EXCLUDED.body`,
      [symbol, tf, JSON.stringify(cs)],
    );
  }
  async snapshot(x: Snapshot) {
    await this.pool.query(
      "INSERT INTO snapshots(symbol,t,event_t,price,bid,ask,volume,volatility,quote_t) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING",
      [
        x.symbol,
        x.t,
        x.eventT,
        x.price,
        x.bid,
        x.ask,
        x.volume,
        x.volatility,
        x.quoteT,
      ],
    );
  }
  async observation(f: Features) {
    await this.pool.query(
      "INSERT INTO observations(id,symbol,horizon,t,due,price,features) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
      [
        randomUUID(),
        f.symbol,
        f.horizon,
        f.t,
        f.t + f.horizon * 60000,
        f.price,
        f,
      ],
    );
  }
  async saveDecision(f: Features, decision: Decision) {
    const { signal, ...prediction } = decision;
    await this.pool.query(
      "UPDATE observations SET decision=$1 WHERE symbol=$2 AND horizon=$3 AND t=$4",
      [
        { ...prediction, signalId: signal?.id ?? null },
        f.symbol,
        f.horizon,
        f.t,
      ],
    );
  }
  async settleObservations(now: number) {
    await this.pool.query(
      `UPDATE observations AS o SET final_price=s.price,final_t=s.event_t,return=s.price/o.price-1,label=CASE WHEN s.price/o.price-1>$2 THEN 2 WHEN s.price/o.price-1< -$2 THEN 0 ELSE 1 END,status='SETTLED' FROM snapshots AS s WHERE o.status='PENDING' AND o.due<=$1 AND s.symbol=o.symbol AND s.t=(SELECT min(t) FROM snapshots WHERE symbol=o.symbol AND t>=o.due AND t<=o.due+2000 AND event_t>=o.due AND event_t<=o.due+2000)`,
      [now, config.RETURN_THRESHOLD],
    );
    await this.pool.query(
      "UPDATE observations SET status='NO_DATA' WHERE status='PENDING' AND due<$1-5000",
      [now],
    );
  }
  async saveSignal(s: Signal, create = false) {
    this.pool.transaction(() => {
      this.pool.query(
        "INSERT INTO signals(id,symbol,horizon,t,status,body) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,body=EXCLUDED.body",
        [s.id, s.symbol, s.horizon, s.t, s.status, s],
      );
      if (create)
        this.pool.query(
          "INSERT INTO outbox(id,signal_id,channel,payload) VALUES($1,$2,'dashboard',$3) ON CONFLICT DO NOTHING",
          [randomUUID(), s.id, s],
        );
    });
  }
  async activeSignals(): Promise<Signal[]> {
    return (
      await this.pool.query(
        "SELECT body FROM signals WHERE status IN('PENDING','FILLED') ORDER BY t",
      )
    ).rows.map((x) => x.body);
  }
  async latestSignals(limit = 200): Promise<Signal[]> {
    return (
      await this.pool.query(
        "SELECT body FROM signals ORDER BY t DESC LIMIT $1",
        [limit],
      )
    ).rows.map((x) => x.body);
  }
  async saveNews(n: NewsEvent) {
    await this.pool.query(
      "INSERT INTO news(id,published_at,available_at,body) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET available_at=EXCLUDED.available_at,body=EXCLUDED.body",
      [n.id, n.publishedAt, n.availableAt, n],
    );
  }
  async recentNews(): Promise<NewsEvent[]> {
    return (
      await this.pool.query(
        "SELECT body FROM news WHERE published_at > $1 ORDER BY published_at DESC LIMIT 500",
        [Date.now() - 172800000],
      )
    ).rows.map((x) => x.body);
  }
  async nearest(
    symbol: string,
    t: number,
    before = false,
  ): Promise<Snapshot | null> {
    const r = await this.pool.query(
      `SELECT * FROM snapshots WHERE symbol=$1 AND t ${before ? "<=" : ">="} $2 AND t ${before ? ">=" : "<="} $3 AND event_t ${before ? "<=" : ">="} $2 ORDER BY t ${before ? "DESC" : "ASC"} LIMIT 1`,
      [symbol, t, t + (before ? -2000 : 2000)],
    );
    const x = r.rows[0];
    return x
      ? {
          symbol: x.symbol,
          t: +x.t,
          eventT: +x.event_t,
          quoteT: +x.quote_t,
          price: x.price,
          bid: x.bid,
          ask: x.ask,
          volume: x.volume,
          volatility: x.volatility,
        }
      : null;
  }
  // Snapshots and observations grow by the second; keep only the recent window on disk.
  async prune(now: number, days: number) {
    const before = now - days * 86400000;
    this.pool.query("DELETE FROM snapshots WHERE t<$1", [before]);
    this.pool.query(
      "DELETE FROM observations WHERE t<$1 AND status<>'PENDING'",
      [before],
    );
  }
  async exportRows() {
    return (
      await this.pool.query(
        "SELECT symbol,horizon,t,due,final_t,features,return,label FROM observations WHERE status='SETTLED' ORDER BY t,symbol,horizon",
      )
    ).rows;
  }
  async stats() {
    const signals = (
      await this.pool.query("SELECT body FROM signals ORDER BY t")
    ).rows.map((x) => x.body as Signal);
    const settled = signals.filter((x) => x.status === "SETTLED");
    const summarize = (ss: Signal[]) => {
      const wins = ss.filter((s) => s.result === "WIN").length,
        losses = ss.filter((s) => s.result === "LOSS").length,
        neutrals = ss.filter((s) => s.result === "NEUTRO").length;
      let streak = 0,
        max = 0;
      for (const s of ss) {
        streak = s.result === "LOSS" ? streak + 1 : 0;
        max = Math.max(max, streak);
      }
      return {
        count: ss.length,
        wins,
        losses,
        neutrals,
        winRate: wins + losses ? wins / (wins + losses) : null,
        maxLossStreak: max,
        paperUnits: wins * config.PAYOUT - losses,
      };
    };
    const grouped = (fn: (s: Signal) => string) => {
      const groups: Record<string, Signal[]> = {};
      for (const s of settled) (groups[fn(s)] ??= []).push(s);
      return Object.fromEntries(
        Object.entries(groups).map(([k, v]) => [k, summarize(v)]),
      );
    };
    const calibrated = (
      await this.pool.query(
        "SELECT json_extract(decision,'$.probability') AS p, CASE WHEN json_extract(decision,'$.probabilities[2]') >= json_extract(decision,'$.probabilities[0]') THEN 'COMPRA' ELSE 'VENDA' END AS direction,label FROM observations WHERE status='SETTLED' AND json_extract(decision,'$.probability') IS NOT NULL",
      )
    ).rows;
    const bins = Array.from({ length: 10 }, (_, i) => {
      const ss = calibrated.filter(
        (s) => Math.min(9, Math.floor(Number(s.p) * 10)) === i,
      );
      return {
        from: i / 10,
        to: (i + 1) / 10,
        count: ss.length,
        predicted: ss.length
          ? ss.reduce((a, s) => a + Number(s.p), 0) / ss.length
          : null,
        observed: ss.length
          ? ss.filter((s) => s.label === (s.direction === "COMPRA" ? 2 : 0))
              .length / ss.length
          : null,
      };
    });
    const counts = (
      await this.pool.query(
        "SELECT status,count(*) AS count FROM observations GROUP BY status",
      )
    ).rows;
    return {
      total: signals.length,
      ...summarize(settled),
      pending: signals.filter((s) => ["PENDING", "FILLED"].includes(s.status))
        .length,
      noData: signals.filter((s) => s.status === "NO_DATA").length,
      invalidated: signals.filter((s) =>
        ["INVALIDATED", "EXPIRED"].includes(s.status),
      ).length,
      byAsset: grouped((s) => s.symbol),
      byHorizon: grouped((s) => String(s.horizon)),
      byHour: grouped((s) =>
        new Date(s.t).toLocaleString("pt-BR", {
          timeZone: "America/Sao_Paulo",
          hour: "2-digit",
          hour12: false,
        }),
      ),
      byStrategy: grouped((s) => s.modelId),
      byNews: grouped((s) =>
        s.features.newsIds.length ? "com notícias" : "sem notícias",
      ),
      calibration: bins,
      payout: config.PAYOUT,
      breakEven: 1 / (1 + config.PAYOUT),
      observations: counts,
    };
  }
  async close() {
    await this.pool.end();
  }
}
