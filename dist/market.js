import WebSocket from "ws";
import { websocketAgent } from "./network.js";
import { EventEmitter } from "node:events";
import { config, symbols } from "./config.js";
import { INTERVALS } from "./types.js";
import { log } from "./log.js";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
export class RestClient {
    offset = 0;
    uncertainty = Infinity;
    syncedAt = 0;
    queue = Promise.resolve();
    async get(path) {
        let release;
        const clock = path === "/api/v3/time";
        const previous = clock ? Promise.resolve() : this.queue;
        if (clock)
            release = () => { };
        else
            this.queue = new Promise((r) => (release = r));
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
                        await delay(Math.max(1000, Number(r.headers.get("retry-after") || 60) * 1000));
                        continue;
                    }
                    if (!r.ok)
                        throw Error(`REST HTTP ${r.status}`);
                    const body = (await r.json());
                    if (path === "/api/v3/time") {
                        const end = Date.now(), serverTime = Number(body.serverTime);
                        if (!Number.isFinite(serverTime))
                            throw Error("serverTime inválido");
                        this.offset = serverTime - (sentAt + end) / 2;
                        this.uncertainty = (end - sentAt) / 2;
                        this.syncedAt = end;
                    }
                    return body;
                }
                catch (e) {
                    if (n === 5)
                        throw e;
                    await delay(Math.min(30000, 500 * 2 ** n) + Math.random() * 300);
                }
            }
            throw Error("REST rate limit");
        }
        finally {
            release();
        }
    }
    async sync() {
        await this.get("/api/v3/time");
    }
    now() {
        return Math.floor(Date.now() + this.offset);
    }
}
export function freezeMarketState(s) {
    return structuredClone(s);
}
export function putCandle(a, c) {
    return [...a.filter((x) => x.t !== c.t), c]
        .sort((x, y) => x.t - y.t)
        .slice(-1500);
}
export function contiguous(a, interval) {
    return a.every((c, i) => i === 0 || c.t - a[i - 1].t === interval);
}
export function feedReasons(s, now, clockOk) {
    const r = [];
    if (!s.connected)
        r.push("WEBSOCKET DESCONECTADO");
    if (!s.ready)
        r.push("HISTÓRICO NÃO CARREGADO");
    if (s.error)
        r.push(s.error);
    if (!clockOk)
        r.push("RELÓGIO NÃO SINCRONIZADO");
    if (!s.trade ||
        now - s.trade.t > config.STALE_MS ||
        now - s.trade.received > config.STALE_MS ||
        s.trade.t > now)
        r.push("TRADES ATRASADOS / TIMESTAMP INCONSISTENTE");
    if (!s.quote || now - s.quote.t > config.STALE_MS)
        r.push("BID/ASK ATRASADO");
    if (!s.book || now - s.book.t > config.STALE_MS)
        r.push("LIVRO PARCIAL ATRASADO");
    if (now - s.connectedAt < 60000)
        r.push("AQUECENDO MICROESTRUTURA (60s)");
    for (const [tf, ms] of Object.entries(INTERVALS)) {
        const a = s.candles[tf];
        if (a.length < 250 || !contiguous(a, ms))
            r.push(`HISTÓRICO ${tf} INSUFICIENTE / GAP`);
        if (!a.length ||
            now - a[a.length - 1].end > ms + 5000 ||
            now - (s.lastKline[tf] || 0) > config.STALE_MS)
            r.push(`CANDLES ${tf} ATRASADOS`);
    }
    return r;
}
export class MarketData extends EventEmitter {
    rest = new RestClient();
    states = new Map();
    sockets = new Map();
    timers = new Set();
    stopped = false;
    syncTimer;
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
    reasons(s) {
        return feedReasons(s, this.rest.now(), this.rest.uncertainty <= config.MAX_CLOCK_UNCERTAINTY_MS &&
            Date.now() - this.rest.syncedAt < 120000);
    }
    async start() {
        try {
            await this.rest.sync();
        }
        catch (e) {
            log.error({ err: e }, "clock sync");
        }
        for (const s of this.states.values())
            this.connect(s, 0);
        this.syncTimer = setInterval(() => void this.rest.sync().catch((e) => {
            this.rest.uncertainty = Infinity;
            log.error({ err: e }, "clock sync");
        }), 60000);
    }
    connect(s, attempt) {
        if (this.stopped)
            return;
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
            if (ws.readyState === WebSocket.OPEN)
                ws.ping();
        }, 15000);
        ws.on("pong", () => (alive = true));
        ws.on("open", () => {
            s.connected = true;
            s.connectedAt = this.rest.now();
            void this.bootstrap(s)
                .then(() => {
                if (this.sockets.get(s.symbol) === ws &&
                    ws.readyState === WebSocket.OPEN) {
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
            }
            catch (e) {
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
            if (this.stopped)
                return;
            const next = this.rest.now() - s.connectedAt > 60000 ? 0 : attempt + 1;
            const timer = setTimeout(() => {
                this.timers.delete(timer);
                this.connect(s, next);
            }, Math.min(30000, 1000 * 2 ** Math.min(next, 5)) + Math.random() * 500);
            this.timers.add(timer);
        });
    }
    async bootstrap(s) {
        for (const tf of Object.keys(INTERVALS)) {
            let raw = await this.rest.get(`/api/v3/klines?symbol=${s.symbol}&interval=${tf}&limit=${tf === "1m" ? 1000 : 600}`);
            if (!Array.isArray(raw) || !raw.length)
                throw Error("klines inválidos");
            if (tf === "1m") {
                const earlier = await this.rest.get(`/api/v3/klines?symbol=${s.symbol}&interval=1m&limit=1000&endTime=${Number(raw[0][0]) - 1}`);
                raw = [...earlier, ...raw];
            }
            const candles = raw
                .map((x) => this.validateCandle({
                t: +x[0],
                o: +x[1],
                h: +x[2],
                l: +x[3],
                c: +x[4],
                v: +x[5],
                end: +x[6],
                quote: +x[7],
                buy: +x[9],
            }))
                .filter((x) => x.end < this.rest.now());
            const merged = new Map(candles.map((c) => [c.t, c]));
            for (const c of s.candles[tf])
                if (c.t >= candles[0]?.t)
                    merged.set(c.t, c);
            s.candles[tf] = [...merged.values()]
                .sort((a, b) => a.t - b.t)
                .slice(-1500);
            if (!contiguous(s.candles[tf], INTERVALS[tf]))
                throw Error(`Gap ${tf}`);
            this.emit("candles", s.symbol, tf, candles);
        }
    }
    validateCandle(c) {
        if (Object.values(c).some((x) => !Number.isFinite(x)) ||
            c.c <= 0 ||
            c.o <= 0 ||
            c.l <= 0 ||
            c.h < c.l ||
            c.h < Math.max(c.o, c.c) ||
            c.l > Math.min(c.o, c.c) ||
            c.v < 0 ||
            c.buy < 0 ||
            c.buy > c.v ||
            c.end < c.t)
            throw Error("Candle inválido");
        return c;
    }
    message(s, msg) {
        const d = msg.data, now = this.rest.now();
        if (!d || !msg.stream)
            throw Error("Envelope inválido");
        if (msg.stream.endsWith("@aggTrade")) {
            const id = Number(d.a), t = Number(d.T), p = Number(d.p), q = Number(d.q);
            if (![id, t, p, q].every(Number.isFinite) ||
                p <= 0 ||
                q <= 0 ||
                typeof d.m !== "boolean")
                throw Error("Trade inválido");
            if (s.trade && id <= s.trade.id)
                return;
            if (s.trade && id !== s.trade.id + 1)
                throw Error("Gap aggTrade");
            if (s.trade && t < s.trade.t)
                throw Error("Trade fora de ordem");
            const trade = { id, t, p, q, buy: !d.m, received: now };
            s.trade = trade;
            s.trades.push(trade);
            s.trades = s.trades.filter((x) => x.t >= now - 180000);
        }
        else if (msg.stream.endsWith("@bookTicker")) {
            const bid = Number(d.b), ask = Number(d.a);
            if (![bid, ask].every(Number.isFinite) || bid <= 0 || ask < bid)
                throw Error("Quote inválida");
            const updateId = Number(d.u);
            if (!Number.isSafeInteger(updateId))
                throw Error("BookTicker ID inválido");
            if (s.quote?.updateId !== undefined && updateId <= s.quote.updateId)
                return;
            s.quote = { t: now, bid, ask, updateId };
        }
        else if (msg.stream.includes("@depth20")) {
            const id = Number(d.lastUpdateId);
            if (!Number.isFinite(id) ||
                !Array.isArray(d.bids) ||
                !Array.isArray(d.asks) ||
                !d.bids.length ||
                !d.asks.length)
                throw Error("Livro inválido");
            if (s.book && id <= s.book.id)
                return;
            const sum = (rows) => rows.reduce((total, row) => {
                const p = Number(row[0]), q = Number(row[1]);
                if (!Number.isFinite(p) || !Number.isFinite(q) || p <= 0 || q < 0)
                    throw Error("Nível inválido");
                return total + q;
            }, 0);
            const bidQty = sum(d.bids), askQty = sum(d.asks), total = bidQty + askQty;
            if (!total)
                throw Error("Livro vazio");
            const old = s.book ? s.book.bidQty + s.book.askQty : total;
            s.book = {
                t: now,
                id,
                bidQty,
                askQty,
                imbalance: (bidQty - askQty) / total,
                change: (total - old) / old,
            };
        }
        else if (d.e === "kline") {
            const k = d.k, tf = k.i;
            if (!(tf in INTERVALS))
                throw Error("Intervalo inesperado");
            const eventTime = Number(d.E);
            if (!Number.isFinite(eventTime) ||
                now - eventTime > config.STALE_MS ||
                eventTime > now + 1000)
                throw Error("Kline atrasado");
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
                if (c.end > now + 1000 ||
                    c.t % INTERVALS[tf] !== 0 ||
                    c.end !== c.t + INTERVALS[tf] - 1)
                    throw Error("Candle futuro / intervalo inválido");
                s.candles[tf] = putCandle(s.candles[tf], c);
                this.emit("candles", s.symbol, tf, [c]);
            }
        }
    }
    stop() {
        this.stopped = true;
        clearInterval(this.syncTimer);
        for (const t of this.timers)
            clearTimeout(t);
        for (const ws of this.sockets.values())
            ws.close();
    }
}
