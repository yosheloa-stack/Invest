import WebSocket from "ws";
import { websocketAgent } from "./network.js";
import { EventEmitter } from "node:events";
import { config, isFx, staleMs, symbols, fxPollMs } from "./config.js";
import { combine, fillGaps, twelveFxSymbol, yahooChart } from "./fx.js";
import { INTERVALS, type Candle, type MarketState, type TF } from "./types.js";
import { log } from "./log.js";
const HOT_FX_MS = 2000;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
export class RestClient {
  offset = 0;
  uncertainty = Infinity;
  syncedAt = 0;
  private queue = Promise.resolve();
  async get<T>(path: string): Promise<T> {
    let release!: () => void;
    const clock = path === "/api/v3/time";
    const previous = clock ? Promise.resolve() : this.queue;
    if (clock) release = () => {};
    else this.queue = new Promise<void>((r) => (release = r));
    await previous;
    try {
      for (let n = 0; n < 6; n++) {
        try {
          await delay(150);
          const sentAt = Date.now();
          const r = await fetch(config.BINANCE_REST + path, {
            signal: AbortSignal.timeout(10000),
          });
          if (r.status === 429 || r.status === 418) {
            await delay(
              Math.max(1000, Number(r.headers.get("retry-after") || 60) * 1000),
            );
            continue;
          }
          if (!r.ok) throw Error(`REST HTTP ${r.status}`);
          const body = (await r.json()) as T;
          if (path === "/api/v3/time") {
            const end = Date.now(),
              serverTime = Number((body as { serverTime: number }).serverTime);
            if (!Number.isFinite(serverTime))
              throw Error("serverTime inválido");
            this.offset = serverTime - (sentAt + end) / 2;
            this.uncertainty = (end - sentAt) / 2;
            this.syncedAt = end;
          }
          return body;
        } catch (e) {
          if (n === 5) throw e;
          await delay(Math.min(30000, 500 * 2 ** n) + Math.random() * 300);
        }
      }
      throw Error("REST rate limit");
    } finally {
      release();
    }
  }
  async sync() {
    await this.get<{ serverTime: number }>("/api/v3/time");
  }
  now() {
    return Math.floor(Date.now() + this.offset);
  }
}
// Point-in-time copy for one analysis pass. Candle and trade records are never edited after
// they arrive (new ones replace them), so copying the arrays and the small live objects is
// enough; a deep clone of 57 assets every second blocked the server for ~0.5-1 s.
export function freezeMarketState(s: MarketState): MarketState {
  const c = s.candles;
  return {
    ...s,
    trade: s.trade && { ...s.trade },
    forming: s.forming && { ...s.forming },
    quote: s.quote && { ...s.quote },
    book: s.book && { ...s.book },
    trades: s.trades.slice(),
    // Candle arrays are replaced (never mutated) when a bar closes, so retaining
    // their current references gives a stable point-in-time view without copying
    // hundreds of thousands of references every second.
    candles: c,
    lastKline: { ...s.lastKline },
  };
}
export function putCandle(a: Candle[], c: Candle): Candle[] {
  return [...a.filter((x) => x.t !== c.t), c]
    .sort((x, y) => x.t - y.t)
    .slice(-1500);
}
export function contiguous(a: Candle[], interval: number) {
  return a.every((c, i) => i === 0 || c.t - a[i - 1].t === interval);
}
export function feedReasons(
  s: MarketState,
  now: number,
  clockOk: boolean,
): string[] {
  const r: string[] = [],
    stale = staleMs(s.symbol);
  if (!s.connected) r.push("WEBSOCKET DESCONECTADO");
  if (!s.ready) r.push("HISTÓRICO NÃO CARREGADO");
  if (s.error) r.push(s.error);
  if (!clockOk) r.push("RELÓGIO NÃO SINCRONIZADO");
  if (
    !s.trade ||
    now - s.trade.t > stale ||
    now - s.trade.received > stale ||
    s.trade.t > now
  )
    r.push("TRADES ATRASADOS / TIMESTAMP INCONSISTENTE");
  if (!s.quote || now - s.quote.t > stale) r.push("BID/ASK ATRASADO");
  if (!s.book || now - s.book.t > stale) r.push("LIVRO PARCIAL ATRASADO");
  if (now - s.connectedAt < 60000) r.push("AQUECENDO MICROESTRUTURA (60s)");
  // Yahoo is polled every few seconds and its last 1m bar can trail by a minute, so a
  // polled symbol's closed candle may be later than an exchange stream's.
  const grace = isFx(s.symbol) ? stale + 60000 : 5000;
  for (const [tf, ms] of Object.entries(INTERVALS) as [TF, number][]) {
    const a = s.candles[tf];
    if (a.length < 250 || (!isFx(s.symbol) && !contiguous(a, ms)))
      r.push(`HISTÓRICO ${tf} INSUFICIENTE / GAP`);
    if (
      !a.length ||
      now - a[a.length - 1].end > ms + grace ||
      now - (s.lastKline[tf] || 0) > stale
    )
      r.push(`CANDLES ${tf} ATRASADOS`);
  }
  return r;
}
export class MarketData extends EventEmitter {
  rest = new RestClient();
  states = new Map<string, MarketState>();
  private sockets = new Map<string, WebSocket>();
  private timers = new Set<NodeJS.Timeout>();
  private fxStream?: WebSocket;
  private fxStreamSymbols = new Map<string, string>();
  private stopped = false;
  private syncTimer?: NodeJS.Timeout;
  // Symbols on someone's screen or with an open robot trade.
  hot = new Set<string>();
  constructor() {
    super();
    for (const symbol of symbols)
      this.states.set(symbol, {
        symbol,
        connected: false,
        ready: false,
        error: null,
        connectedAt: 0,
        trades: [],
        candles: { "1m": [], "5m": [], "15m": [], "1h": [] },
        lastKline: {},
      });
  }
  reasons(s: MarketState) {
    return feedReasons(
      s,
      this.rest.now(),
      this.rest.uncertainty <= config.MAX_CLOCK_UNCERTAINTY_MS &&
        Date.now() - this.rest.syncedAt < 120000,
    );
  }
  async start() {
    try {
      await this.rest.sync();
    } catch (e) {
      log.error({ err: e }, "clock sync");
    }
    let fx = 0;
    const realtimeFx = new Set<string>();
    if (config.TWELVE_DATA_API_KEY) {
      for (const s of this.states.values()) {
        const provider = twelveFxSymbol(s.symbol);
        if (provider) {
          realtimeFx.add(s.symbol);
          this.fxStreamSymbols.set(provider, s.symbol);
        }
      }
    }
    for (const s of this.states.values())
      if (isFx(s.symbol)) {
        // Bootstrap all non-crypto instruments from Yahoo. True FX pairs then
        // receive live ticks from Twelve Data instead of waiting for Yahoo polls.
        this.pollFx(s, fx++ * 900, realtimeFx.has(s.symbol));
      } else this.connect(s, 0);
    if (realtimeFx.size) this.connectFxStream();
    this.syncTimer = setInterval(
      () =>
        void this.rest.sync().catch((e) => {
          this.rest.uncertainty = Infinity;
          log.error({ err: e }, "clock sync");
        }),
      60000,
    );
  }
  private connect(s: MarketState, attempt: number) {
    if (this.stopped) return;
    s.ready = false;
    s.error = null;
    s.lastKline = {};
    s.trades = [];
    s.trade = undefined;
    s.forming = undefined;
    s.formingAt = undefined;
    s.quote = undefined;
    s.book = undefined;
    const streams = [
      "aggTrade",
      "bookTicker",
      "depth20@100ms",
      ...Object.keys(INTERVALS).map((tf) => `kline_${tf}`),
    ]
      .map((x) => s.symbol.toLowerCase() + "@" + x)
      .join("/");
    const ws = new WebSocket(config.BINANCE_WS + "?streams=" + streams, {
      agent: websocketAgent,
    });
    this.sockets.set(s.symbol, ws);
    let alive = true;
    const heartbeat = setInterval(() => {
      if (!alive) {
        s.error = "HEARTBEAT EXPIRADO";
        ws.terminate();
        return;
      }
      alive = false;
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 15000);
    ws.on("pong", () => (alive = true));
    ws.on("open", () => {
      s.connected = true;
      s.connectedAt = this.rest.now();
      void this.bootstrap(s)
        .then(() => {
          if (
            this.sockets.get(s.symbol) === ws &&
            ws.readyState === WebSocket.OPEN
          ) {
            s.ready = true;
            log.info({ symbol: s.symbol }, "bootstrap pronto");
          }
        })
        .catch((e) => {
          s.error = "ERRO NA FONTE PRINCIPAL";
          log.error({ err: e, symbol: s.symbol }, "bootstrap");
          ws.terminate();
        });
    });
    ws.on("message", (raw) => {
      try {
        this.message(s, JSON.parse(raw.toString()));
      } catch (e) {
        s.error = "DADOS INVÁLIDOS / GAP";
        log.error({ err: e, symbol: s.symbol }, "feed inválido");
        ws.terminate();
      }
    });
    ws.on("error", (e) => {
      s.error = "ERRO NA FONTE PRINCIPAL";
      log.error({ err: e, symbol: s.symbol }, "websocket");
    });
    ws.on("close", () => {
      clearInterval(heartbeat);
      s.connected = false;
      s.ready = false;
      this.emit("disconnect", s.symbol);
      if (this.stopped) return;
      const next = this.rest.now() - s.connectedAt > 60000 ? 0 : attempt + 1;
      const timer = setTimeout(
        () => {
          this.timers.delete(timer);
          this.connect(s, next);
        },
        Math.min(30000, 1000 * 2 ** Math.min(next, 5)) + Math.random() * 500,
      );
      this.timers.add(timer);
    });
  }
  async bootstrap(s: MarketState) {
    for (const tf of Object.keys(INTERVALS) as TF[]) {
      let raw = await this.rest.get<unknown[][]>(
        `/api/v3/klines?symbol=${s.symbol}&interval=${tf}&limit=${tf === "1m" ? 1000 : 600}`,
      );
      if (!Array.isArray(raw) || !raw.length) throw Error("klines inválidos");
      if (tf === "1m") {
        const earlier = await this.rest.get<unknown[][]>(
          `/api/v3/klines?symbol=${s.symbol}&interval=1m&limit=1000&endTime=${Number(raw[0][0]) - 1}`,
        );
        raw = [...earlier, ...raw];
      }
      const candles = raw
        .map((x) =>
          this.validateCandle({
            t: +x[0]!,
            o: +x[1]!,
            h: +x[2]!,
            l: +x[3]!,
            c: +x[4]!,
            v: +x[5]!,
            end: +x[6]!,
            quote: +x[7]!,
            buy: +x[9]!,
          }),
        )
        .filter((x) => x.end < this.rest.now());
      const merged = new Map(candles.map((c) => [c.t, c]));
      for (const c of s.candles[tf])
        if (c.t >= candles[0]?.t) merged.set(c.t, c);
      s.candles[tf] = [...merged.values()]
        .sort((a, b) => a.t - b.t)
        .slice(-1500);
      if (!contiguous(s.candles[tf], INTERVALS[tf])) throw Error(`Gap ${tf}`);
      this.emit("candles", s.symbol, tf, candles);
    }
  }
  private validateCandle(c: Candle) {
    if (
      Object.values(c).some((x) => !Number.isFinite(x)) ||
      c.c <= 0 ||
      c.o <= 0 ||
      c.l <= 0 ||
      c.h < c.l ||
      c.h < Math.max(c.o, c.c) ||
      c.l > Math.min(c.o, c.c) ||
      c.v < 0 ||
      c.buy < 0 ||
      c.buy > c.v ||
      c.end < c.t
    )
      throw Error("Candle inválido");
    return c;
  }
  private message(
    s: MarketState,
    msg: { stream: string; data: Record<string, any> },
  ) {
    const d = msg.data,
      now = this.rest.now();
    if (!d || !msg.stream) throw Error("Envelope inválido");
    if (msg.stream.endsWith("@aggTrade")) {
      const id = Number(d.a),
        t = Number(d.T),
        p = Number(d.p),
        q = Number(d.q);
      if (
        ![id, t, p, q].every(Number.isFinite) ||
        p <= 0 ||
        q <= 0 ||
        typeof d.m !== "boolean"
      )
        throw Error("Trade inválido");
      if (s.trade && id <= s.trade.id) return;
      if (s.trade && id !== s.trade.id + 1) throw Error("Gap aggTrade");
      if (s.trade && t < s.trade.t) throw Error("Trade fora de ordem");
      const trade = { id, t, p, q, buy: !d.m, received: now };
      s.trade = trade;
      s.trades.push(trade);
      // Trades arrive in time order; cut the old front in batches (a full filter on every
      // trade was O(n) per message on busy pairs). Readers filter by time themselves.
      if (s.trades[0].t < now - 200000)
        s.trades = s.trades.filter((x) => x.t >= now - 180000);
    } else if (msg.stream.endsWith("@bookTicker")) {
      const bid = Number(d.b),
        ask = Number(d.a);
      if (![bid, ask].every(Number.isFinite) || bid <= 0 || ask < bid)
        throw Error("Quote inválida");
      const updateId = Number(d.u);
      if (!Number.isSafeInteger(updateId))
        throw Error("BookTicker ID inválido");
      if (s.quote?.updateId !== undefined && updateId <= s.quote.updateId)
        return;
      s.quote = { t: now, bid, ask, updateId };
    } else if (msg.stream.includes("@depth20")) {
      const id = Number(d.lastUpdateId);
      if (
        !Number.isFinite(id) ||
        !Array.isArray(d.bids) ||
        !Array.isArray(d.asks) ||
        !d.bids.length ||
        !d.asks.length
      )
        throw Error("Livro inválido");
      if (s.book && id <= s.book.id) return;
      const sum = (rows: unknown[][]) =>
        rows.reduce((total, row) => {
          const p = Number(row[0]),
            q = Number(row[1]);
          if (!Number.isFinite(p) || !Number.isFinite(q) || p <= 0 || q < 0)
            throw Error("Nível inválido");
          return total + q;
        }, 0);
      const bidQty = sum(d.bids),
        askQty = sum(d.asks),
        total = bidQty + askQty;
      if (!total) throw Error("Livro vazio");
      const old = s.book ? s.book.bidQty + s.book.askQty : total;
      s.book = {
        t: now,
        id,
        bidQty,
        askQty,
        imbalance: (bidQty - askQty) / total,
        change: (total - old) / old,
      };
    } else if (d.e === "kline") {
      const k = d.k,
        tf = k.i as TF;
      if (!(tf in INTERVALS)) throw Error("Intervalo inesperado");
      const eventTime = Number(d.E);
      if (!Number.isFinite(eventTime) || eventTime > now + 1000)
        throw Error("Kline inválido");
      // A late message is skipped, not fatal: it usually means this process was busy, and
      // dropping every socket at once would take all charts down. Staleness still shows
      // through lastKline.
      if (now - eventTime > config.STALE_MS) return;
      s.lastKline[tf] = now;
      if (tf === "1m" && !k.x && eventTime >= (s.formingAt ?? 0)) {
        s.forming = this.validateCandle({
          t: +k.t,
          end: +k.T,
          o: +k.o,
          h: +k.h,
          l: +k.l,
          c: +k.c,
          v: +k.v,
          buy: +k.V,
          quote: +k.q,
        });
        s.formingAt = eventTime;
      }
      if (k.x) {
        const c = this.validateCandle({
          t: +k.t,
          end: +k.T,
          o: +k.o,
          h: +k.h,
          l: +k.l,
          c: +k.c,
          v: +k.v,
          buy: +k.V,
          quote: +k.q,
        });
        if (
          c.end > now + 1000 ||
          c.t % INTERVALS[tf] !== 0 ||
          c.end !== c.t + INTERVALS[tf] - 1
        )
          throw Error("Candle futuro / intervalo inválido");
        s.candles[tf] = putCandle(s.candles[tf], c);
        this.emit("candles", s.symbol, tf, [c]);
      }
    }
  }
  // Forex: Yahoo Finance is polled; the state mimics a feed without volume or book.
  private pollFx(s: MarketState, wait: number, streaming = false) {
    const timer = setTimeout(async () => {
      this.timers.delete(timer);
      if (this.stopped) return;
      try {
        if (!s.ready) {
          await this.bootstrapFx(s);
          s.connected = true;
          s.connectedAt = this.rest.now();
          s.ready = true;
          log.info({ symbol: s.symbol }, "forex pronto");
        }
        await this.tickFx(s, streaming);
        s.error = null;
      } catch (e) {
        s.error = "ERRO NA FONTE FOREX";
        log.warn({ err: e, symbol: s.symbol }, "forex");
      }
      // Streaming Forex needs Yahoo only as a periodic reconciliation/history source.
      // Other Yahoo instruments keep the existing polling path.
      this.pollFx(
        s,
        streaming ? 60000 : this.hot.has(s.symbol) ? HOT_FX_MS : fxPollMs,
        streaming,
      );
    }, wait);
    this.timers.add(timer);
  }
  private connectFxStream(attempt = 0) {
    if (this.stopped || !config.TWELVE_DATA_API_KEY || !this.fxStreamSymbols.size) return;
    const ws = new WebSocket(
      `wss://ws.twelvedata.com/v1/quotes/price?apikey=${encodeURIComponent(config.TWELVE_DATA_API_KEY)}`,
    );
    this.fxStream = ws;
    let opened = false;
    ws.on("open", () => {
      opened = true;
      const symbols = [...this.fxStreamSymbols.keys()].join(",");
      ws.send(JSON.stringify({ action: "subscribe", params: { symbols } }));
      log.info({ symbols: this.fxStreamSymbols.size }, "forex realtime conectado");
    });
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          event?: string;
          symbol?: string;
          price?: string | number;
          timestamp?: number;
          status?: string;
          message?: string;
        };
        if (msg.event !== "price" || !msg.symbol) return;
        const local = this.fxStreamSymbols.get(msg.symbol);
        if (!local) return;
        const s = this.states.get(local);
        const p = Number(msg.price);
        if (!s || !Number.isFinite(p) || p <= 0) return;
        const now = msg.timestamp ? msg.timestamp * 1000 : this.rest.now();
        this.applyFxTick(s, p, now);
      } catch (e) {
        log.debug({ err: e }, "forex tick inválido");
      }
    });
    const reconnect = () => {
      if (this.fxStream === ws) this.fxStream = undefined;
      if (this.stopped) return;
      const next = opened ? 0 : attempt + 1;
      const wait = Math.min(30000, 1000 * 2 ** Math.min(next, 5));
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.connectFxStream(next);
      }, wait);
      this.timers.add(timer);
    };
    ws.on("close", reconnect);
    ws.on("error", (e) => log.warn({ err: e }, "forex realtime"));
  }
  private applyFxTick(s: MarketState, p: number, at: number) {
    const minute = Math.floor(at / 60000) * 60000;
    const current = s.forming;
    if (!current || current.t !== minute) {
      // Finalize the previous live minute before starting the new one.
      if (current && current.t < minute) {
        const closed = { ...current, end: current.t + 59999 };
        s.candles["1m"] = putCandle(s.candles["1m"], closed);
        this.emit("candles", s.symbol, "1m", [closed]);
      }
      s.forming = {
        t: minute,
        end: minute + 59999,
        o: p,
        h: p,
        l: p,
        c: p,
        v: 1,
        buy: 0.5,
        quote: 0,
      };
    } else {
      s.forming = {
        ...current,
        h: Math.max(current.h, p),
        l: Math.min(current.l, p),
        c: p,
        v: current.v + 1,
      };
    }
    s.formingAt = at;
    s.trade = {
      id: (s.trade?.id ?? 0) + 1,
      t: at,
      received: this.rest.now(),
      p,
      q: 0,
      buy: true,
    };
    s.quote = { t: at, bid: p, ask: p };
    s.book = {
      t: at,
      id: (s.book?.id ?? 0) + 1,
      bidQty: 1,
      askQty: 1,
      imbalance: 0,
      change: 0,
    };
    s.lastKline["1m"] = at;
    s.connected = true;
    s.error = null;
  }
  private async bootstrapFx(s: MarketState) {
    const now = this.rest.now(),
      back = { "1m": 3, "5m": 8, "15m": 20, "1h": 70 } as Record<TF, number>;
    for (const tf of Object.keys(INTERVALS) as TF[]) {
      const ms = INTERVALS[tf],
        { bars } = await yahooChart(
          s.symbol,
          tf,
          now - back[tf] * 86400000,
          now,
        );
      const closed = fillGaps(
        bars.filter((c) => c.end < now),
        ms,
        5,
      ).slice(-1500);
      if (closed.length < 250) throw Error(`Forex ${tf}: só ${closed.length}`);
      s.candles[tf] = closed;
      s.lastKline[tf] = now;
      this.emit("candles", s.symbol, tf, closed);
    }
  }
  private async tickFx(s: MarketState, streaming = false) {
    const now = this.rest.now(),
      { price, bars } = await yahooChart(s.symbol, "1m", now - 20 * 60000, now),
      last = bars[bars.length - 1];
    if (!last) throw Error("Forex sem candles recentes");
    const closed = bars.filter((c) => c.end < now),
      prev = s.candles["1m"];
    const fresh = fillGaps(
      [...prev.slice(-1), ...closed.filter((c) => c.t > (prev.at(-1)?.t ?? 0))],
      60000,
      5,
    ).slice(prev.length ? 1 : 0);
    for (const c of fresh) s.candles["1m"] = putCandle(s.candles["1m"], c);
    if (fresh.length) this.emit("candles", s.symbol, "1m", fresh);
    // Higher timeframes are built from the 1m bars once their window has closed.
    for (const tf of ["5m", "15m", "1h"] as TF[]) {
      const ms = INTERVALS[tf],
        a = s.candles[tf];
      for (
        let t = (a.at(-1)?.t ?? Math.floor(now / ms) * ms - ms) + ms;
        t + ms - 1 < now;
        t += ms
      ) {
        const c = combine(
          s.candles["1m"].filter((b) => b.t >= t && b.t < t + ms),
          t,
          ms,
        );
        if (!c) break;
        s.candles[tf] = putCandle(s.candles[tf], c);
        this.emit("candles", s.symbol, tf, [c]);
      }
      s.lastKline[tf] = now;
    }
    s.lastKline["1m"] = now;
    // A stale quote (market closed) keeps its own timestamp so the feed shows as late.
    const p = price ?? last.c,
      at = last.t >= now - 3 * 60000 ? now : last.end;
    // Never mix a delayed Yahoo forming bar/quote into a realtime FX candle.
    // Doing that can move O/H/L/C backwards and produces clipped/deformed candles.
    if (!streaming) {
      if (last.end >= now) {
        s.forming = {
          ...last,
          c: p,
          h: Math.max(last.h, p),
          l: Math.min(last.l, p),
        };
        s.formingAt = now;
      }
      s.trade = {
        id: (s.trade?.id ?? 0) + 1,
        t: at,
        received: at,
        p,
        q: 0,
        buy: true,
      };
      s.quote = { t: at, bid: p, ask: p };
      s.book = {
        t: at,
        id: (s.book?.id ?? 0) + 1,
        bidQty: 1,
        askQty: 1,
        imbalance: 0,
        change: 0,
      };
    }
  }
  stop() {
    this.stopped = true;
    clearInterval(this.syncTimer);
    for (const t of this.timers) clearTimeout(t);
    for (const ws of this.sockets.values()) ws.close();
    this.fxStream?.close();
  }
}
