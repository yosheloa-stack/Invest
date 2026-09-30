import { applyPaperFeedback } from "./paper-feedback.js";
import "./network.js";
import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signalBlocked } from "./signal-gate.js";
import { liveCandle } from "./live-candle.js";
import { mountAuth } from "./web-auth.js";
import { Accounts } from "./accounts.js";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config.js";
import { log } from "./log.js";
import { MarketData, freezeMarketState } from "./market.js";
import { Store } from "./store.js";
import { NewsIntelligenceEngine } from "./news.js";
import { ModelRegistry } from "./models.js";
import { buildFeatures } from "./features.js";
import { evaluate, advanceSignal, strategyDecision } from "./signals.js";
import { StrategyLab } from "./lab.js";
import { Robot } from "./robot-runner.js";
import { HORIZONS, } from "./types.js";
import { technical } from "./indicators.js";
const store = new Store(), market = new MarketData(), news = new NewsIntelligenceEngine(store), models = new ModelRegistry(), lab = new StrategyLab(market.rest);
const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self' ws: wss:; style-src 'self'; img-src 'self' data:; script-src 'self'; frame-ancestors 'none'");
    next();
});
let accounts = null, robot = null;
app.set("trust proxy", 1);
app.get("/healthz", (_req, res) => res.json({ status: "alive" }));
const auth = mountAuth(app, () => accounts, {
    publicOrigin: config.PUBLIC_ORIGIN,
    allowSignup: config.ALLOW_SIGNUP,
});
// The page and its assets are public; every data endpoint requires a logged-in account.
app.use(express.static("public", { index: false }));
app.get(["/", "/login"], (_req, res) => res.sendFile("index.html", { root: "public" }));
app.use("/api", auth.requireUser);
const server = createServer(app), wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 1024,
    verifyClient: ({ req }) => auth.wsAuthorized(req),
});
let initialized = false, busy = false, stopping = false, lastBucket = -1, stats = null, newsList = [], newsCategories = [], recent = [], dbError = null;
const features = new Map(), decisions = new Map(), active = new Map(), cooldowns = new Map(), strategyCandle = new Map();
function labReason(symbol, h) {
    if (!lab.evaluations.length)
        return `LABORATÓRIO DE ESTRATÉGIAS: ${lab.status}`;
    const ok = lab.approved(symbol, h);
    return ok.length
        ? `AGUARDANDO GATILHO: ${ok.map((x) => x.label).join(" | ")}`
        : "NENHUMA ESTRATÉGIA APROVADA NO BACKTEST PARA ESTE ATIVO/HORIZONTE";
}
function blocked(symbol, now) {
    return signalBlocked(symbol, now, config.COOLDOWN_MS, cooldowns, active.values());
}
let candleQueue = Promise.resolve();
market.on("candles", (symbol, tf, cs) => {
    candleQueue = candleQueue
        .then(() => store.candles(symbol, tf, cs))
        .catch((e) => {
        store.healthy = false;
        dbError = "FALHA DE PERSISTÊNCIA";
        log.error({ err: e }, "candles persist");
    });
});
function view() {
    const now = market.rest.now();
    return {
        time: now,
        mode: "PAPER",
        sniper: config.SNIPER,
        database: store.healthy ? "OK" : dbError || "INICIALIZANDO",
        newsStatus: news.status,
        newsCapabilities: {
            semanticDedup: config.EMBEDDING_MODEL ? "CONFIGURADA" : "NÃO CONFIGURADA",
            classification: news.configured ? "CONFIGURADA" : "NÃO CONFIGURADA",
        },
        newsLastSuccess: news.lastSuccess,
        models: models.summary(),
        modelErrors: models.errors,
        strategies: lab.brief(),
        robot: robot?.brief() ?? null,
        metrics: stats,
        news: newsList,
        newsCategories,
        signals: recent.slice(0, 100).map(({ features, ...x }) => x),
        assets: [...market.states.values()].map((s) => {
            const reasons = market.reasons(s);
            if (!store.healthy)
                reasons.push("BANCO INDISPONÍVEL");
            const f = features.get(s.symbol + ":5"), cs = s.candles["1m"], price = s.trade?.p ?? null, first = cs[Math.max(0, cs.length - 61)], change = price && first ? price / first.c - 1 : null;
            return {
                symbol: s.symbol,
                price,
                change,
                changeLabel: "últimos 60 candles 1m",
                feed: reasons.length ? "ANÁLISE INDISPONÍVEL" : "CONECTADO",
                reasons,
                eventTime: s.trade?.t ?? null,
                quote: s.quote ?? null,
                chart: cs.slice(-30).map((c) => ({ t: c.end, p: c.c })),
                indicators: f?.indicators ?? null,
                features: f?.details ?? null,
                groups: f?.groups ?? null,
                forecasts: HORIZONS.map((h) => {
                    const d = decisions.get(s.symbol)?.find((x) => x.horizon === h);
                    if (reasons.length)
                        return {
                            horizon: h,
                            state: "ANÁLISE INDISPONÍVEL",
                            reason: reasons.join("; "),
                            probability: null,
                            favorable: [],
                            contrary: [],
                        };
                    if (d?.signal) {
                        const signal = active.get(d.signal.id) ||
                            recent.find((x) => x.id === d.signal.id) ||
                            d.signal;
                        if (now > signal.expires || signal.status !== "PENDING")
                            return {
                                ...d,
                                state: "SEM ENTRADA",
                                reason: `ÚLTIMO SINAL: ${signal.status}`,
                                signal,
                            };
                        return { ...d, signal };
                    }
                    return (d ?? {
                        horizon: h,
                        state: "ANÁLISE INDISPONÍVEL",
                        reason: "INICIALIZANDO ANÁLISE",
                        probability: null,
                        favorable: [],
                        contrary: [],
                    });
                }),
            };
        }),
    };
}
app.get("/api/health", (_req, res) => {
    const ready = initialized &&
        store.healthy &&
        [...market.states.values()].every((s) => !market.reasons(s).length);
    res.status(ready ? 200 : 503).json({
        status: ready ? "ready" : "degraded",
        database: store.healthy,
        feeds: [...market.states.values()].map((s) => ({
            symbol: s.symbol,
            reasons: market.reasons(s),
        })),
        models: models.summary(),
        news: news.status,
    });
});
let backupBusy = false;
app.get("/api/backup", auth.requireAdmin, async (_req, res) => {
    if (backupBusy || !initialized || !store.healthy) {
        res.status(503).json({
            error: "Backup indisponível; aguarde inicialização ou backup em andamento",
        });
        return;
    }
    backupBusy = true;
    let dir;
    try {
        dir = await mkdtemp(join(tmpdir(), "scanner-backup-"));
        const file = join(dir, "scanner.sqlite");
        await store.pool.backupTo(file);
        res.download(file, `scanner-backup-${Date.now()}.sqlite`, () => {
            void rm(dir, { recursive: true, force: true });
            backupBusy = false;
        });
    }
    catch (e) {
        if (dir)
            await rm(dir, { recursive: true, force: true });
        backupBusy = false;
        log.error({ err: e }, "backup");
        if (!res.headersSent)
            res.status(503).json({ error: "Falha ao gerar backup" });
    }
});
app.get("/api/state", (_req, res) => res.json(view()));
app.get("/api/signals", async (_req, res) => {
    try {
        res.json(await store.latestSignals(500));
    }
    catch {
        res.status(503).json({ error: "BANCO INDISPONÍVEL" });
    }
});
app.get("/api/metrics", (_req, res) => res.json(stats));
app.get("/api/news", (_req, res) => res.json({
    status: news.status,
    events: newsList,
    categories: newsCategories,
}));
app.get("/api/strategies", (_req, res) => res.json(lab.summary()));
function closedCandles(symbol) {
    const s = market.states.get(symbol), now = market.rest.now();
    return s ? s.candles["1m"].filter((c) => c.end < now) : [];
}
function candleAt(symbol, t) {
    const s = market.states.get(symbol);
    return s?.candles["1m"].find((c) => c.t <= t && t <= c.end) ?? null;
}
function priceOf(symbol) {
    const s = market.states.get(symbol);
    if (!s?.trade || market.reasons(s).length)
        return null;
    return { p: s.trade.p, t: s.trade.t };
}
app.get("/api/robot", (_req, res) => {
    if (!robot)
        return void res.status(503).json({ error: "Robô iniciando" });
    res.json(robot.summary());
});
app.post("/api/robot/toggle", express.json({ limit: "1kb" }), auth.requireAdmin, (req, res) => {
    if (!robot)
        return void res.status(503).json({ error: "Robô iniciando" });
    robot.setEnabled(Boolean(req.body?.enabled));
    res.json({ enabled: robot.enabled });
});
app.post("/api/robot/settings", express.json({ limit: "1kb" }), auth.requireAdmin, (req, res) => {
    if (!robot)
        return void res.status(503).json({ error: "Robô iniciando" });
    const list = Array.isArray(req.body?.horizons)
        ? req.body.horizons.map(Number)
        : [];
    robot.setHorizons(list);
    res.json({ horizons: robot.horizons });
});
// Live reading of one asset for the chart screen (rules only, no AI budget spent).
app.get("/api/robot/read/:symbol", (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    if (!robot || !market.states.has(symbol))
        return void res.status(404).json({ error: "Ativo não monitorado" });
    const read = robot.read(symbol, closedCandles(symbol));
    res.json({
        enabled: robot.enabled,
        horizons: robot.horizons,
        ai: robot.ai.enabled,
        labReady: lab.evaluations.length > 0,
        labStatus: lab.status,
        read,
        trades: robot.trades.filter((t) => t.symbol === symbol).slice(0, 20),
    });
});
app.post("/api/robot/analyze", express.json({ limit: "1kb" }), async (req, res) => {
    const symbol = String(req.body?.symbol || "").toUpperCase();
    if (!robot || !market.states.has(symbol))
        return void res.status(404).json({ error: "Ativo não monitorado" });
    const closed = closedCandles(symbol);
    const read = robot.read(symbol, closed);
    if (!read)
        return void res
            .status(503)
            .json({ error: "Histórico de candles ainda insuficiente" });
    const text = robot.ai.enabled ? await robot.ai.explain(read, closed) : null;
    res.json({
        read,
        text,
        source: text ? "ia" : "regras",
        model: text ? robot.ai.model : null,
        aiError: robot.ai.enabled && !text ? robot.ai.lastError : null,
    });
});
app.get("/api/models", (_req, res) => res.json({ models: models.summary(), errors: models.errors }));
app.get("/api/candles/:symbol", (req, res) => {
    const s = market.states.get(String(req.params.symbol).toUpperCase());
    if (!s)
        return void res.status(404).json({ error: "Ativo não monitorado" });
    const limit = Math.min(1000, Math.max(60, Number(req.query.limit) || 240)), cs = s.candles["1m"], from = cs[Math.max(0, cs.length - limit)]?.t ?? 0, now = market.rest.now();
    res.json({
        symbol: s.symbol,
        candles: cs.slice(-limit).map((c) => ({
            t: c.t,
            o: c.o,
            h: c.h,
            l: c.l,
            c: c.c,
            v: c.v,
            buy: c.buy,
        })),
        signals: recent
            .filter((x) => x.symbol === s.symbol && x.t >= from)
            .map(({ features, ...x }) => x),
        triggers: lab.triggers(s.symbol, cs.filter((c) => c.end < now), limit),
    });
});
wss.on("connection", (ws, req) => {
    ws.send(JSON.stringify(view()));
    ws.on("error", (e) => log.warn({ err: e }, "dashboard socket"));
});
// Forming 1m candle of every asset built from the live trades, pushed 4x per second.
let lastTicks = "", lastTickSentAt = 0;
function liveTicks() {
    if (!wss.clients.size)
        return;
    const k = {};
    for (const s of market.states.values()) {
        const now = market.rest.now();
        const tradeFresh = s.trade &&
            now - s.trade.received <= config.STALE_MS &&
            now - s.trade.t <= config.STALE_MS;
        const candleFresh = s.forming && now - (s.formingAt ?? 0) <= config.STALE_MS;
        if (!tradeFresh && !candleFresh)
            continue;
        const b = liveCandle(s);
        if (b)
            k[s.symbol] = [b.t, b.o, b.h, b.l, b.c, b.v, b.buy];
    }
    const body = JSON.stringify(k);
    const sentAt = market.rest.now();
    // Periodic snapshot also initializes new/reconnected viewers of quiet pairs.
    // OHLC is unchanged; this heartbeat never invents a price movement.
    if (body === lastTicks && sentAt - lastTickSentAt < 1000)
        return;
    lastTicks = body;
    lastTickSentAt = sentAt;
    const payload = `{"type":"tick","t":${market.rest.now()},"k":${body}}`;
    for (const ws of wss.clients)
        if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 250000)
            ws.send(payload);
}
function broadcast() {
    const payload = JSON.stringify(view());
    for (const ws of wss.clients)
        if (ws.readyState === WebSocket.OPEN) {
            if (ws.bufferedAmount > 1000000)
                ws.close(1013, "Cliente lento");
            else
                ws.send(payload);
        }
}
async function initialize() {
    await store.init();
    const acc = new Accounts(store.pool);
    acc.seedAdmin(config.DASHBOARD_USER, config.DASHBOARD_PASSWORD);
    accounts = acc;
    log.info({ engine: "node:sqlite" }, "SQLite inicializado");
    await models.load();
    await news.init();
    recent = await store.latestSignals(500);
    for (const s of await store.activeSignals()) {
        if (s.status === "PENDING") {
            s.status = "INVALIDATED";
            s.reason = "REINÍCIO DO COLETOR";
            await store.saveSignal(s);
        }
        else
            active.set(s.id, s);
    }
    for (const s of recent)
        cooldowns.set(`${s.symbol}:${s.horizon}`, Math.max(cooldowns.get(`${s.symbol}:${s.horizon}`) || 0, s.t));
    robot = new Robot(store.pool, lab, () => market.rest.now());
    robot.load();
    await market.start();
    lab.start();
    initialized = true;
    stats = await store.stats();
}
async function tick() {
    if (busy || !initialized || stopping)
        return;
    busy = true;
    try {
        const now = market.rest.now();
        let signalsChanged = false;
        // Freeze point-in-time inputs before any await; sockets may mutate live state during I/O.
        const cycle = [...market.states.values()].map(freezeMarketState);
        const bucket = Math.floor(now / 60000), isNewBucket = bucket !== lastBucket;
        const candidates = new Map();
        if (isNewBucket && store.healthy)
            for (const s of cycle)
                if (!market.reasons(s).length)
                    candidates.set(s.symbol, HORIZONS.map((h) => buildFeatures(s, h, now, news.context(s.symbol, now, h), news.ready())));
        if (!store.healthy) {
            await store.ping();
            dbError = null;
        }
        for (const s of cycle)
            if (!market.reasons(s).length) {
                const i = features.get(s.symbol + ":5")?.indicators ??
                    technical(s.candles["1m"]);
                const volume = s.trades
                    .filter((t) => t.t > now - 60000)
                    .reduce((a, t) => a + t.q, 0);
                await store.snapshot({
                    symbol: s.symbol,
                    t: Math.floor(now),
                    eventT: s.trade.t,
                    quoteT: s.quote.t,
                    price: s.trade.p,
                    bid: s.quote.bid,
                    ask: s.quote.ask,
                    volume,
                    volatility: i.atr / s.trade.p,
                });
            }
        for (const [id, sig] of active) {
            const s = cycle.find((x) => x.symbol === sig.symbol), next = advanceSignal(sig, s?.quote, now, Boolean(s && !market.reasons(s).length && store.healthy));
            if (JSON.stringify(sig) !== JSON.stringify(next)) {
                await store.saveSignal(next);
                signalsChanged = true;
                active.set(id, next);
                recent = [next, ...recent.filter((x) => x.id !== id)].slice(0, 500);
            }
            if (!["FILLED", "PENDING"].includes(next.status))
                active.delete(id);
        }
        await store.settleObservations(now);
        if (isNewBucket) {
            lastBucket = bucket;
            if (bucket % 60 === 0)
                await store.prune(now, config.RETENTION_DAYS);
            await models.load();
            for (const s of cycle) {
                const fs = candidates.get(s.symbol);
                if (!fs)
                    continue;
                const ds = [];
                for (const f of fs) {
                    const h = f.horizon, key = `${s.symbol}:${h}`;
                    features.set(key, f);
                    await store.observation(f);
                    let d = applyPaperFeedback(evaluate(f, models, news.ready(), config.SNIPER), recent, market.rest.now(), config.PAYOUT);
                    if (!models.models.has(key))
                        d = { ...d, state: "SEM ENTRADA", reason: labReason(s.symbol, h) };
                    if (d.signal) {
                        const live = market.states.get(s.symbol);
                        if (market.reasons(live).length ||
                            market.rest.now() - f.t > config.STALE_MS) {
                            d = {
                                ...d,
                                state: "ANÁLISE INDISPONÍVEL",
                                reason: "FEED ALTERADO DURANTE A ANÁLISE",
                                signal: undefined,
                            };
                        }
                        else if (blocked(s.symbol, now)) {
                            d = {
                                ...d,
                                state: "SEM ENTRADA",
                                reason: "COOLDOWN / PAPER EM ANDAMENTO",
                                signal: undefined,
                            };
                        }
                        else {
                            await store.saveSignal(d.signal, true);
                            signalsChanged = true;
                            active.set(d.signal.id, d.signal);
                            recent = [d.signal, ...recent].slice(0, 500);
                            cooldowns.set(key, now);
                        }
                    }
                    await store.saveDecision(f, d);
                    ds.push(d);
                }
                decisions.set(s.symbol, ds);
            }
            stats = await store.stats();
        }
        // Strategy triggers run as soon as a 1m candle closes, independent of the minute bucket.
        const newsOk = !(config.NEWS_REQUIRED || config.SNIPER) || news.ready();
        for (const s of cycle) {
            if (!lab.evaluations.length ||
                !newsOk ||
                market.reasons(s).length ||
                !store.healthy)
                continue;
            const closed = s.candles["1m"].filter((c) => c.end < now), cl = closed[closed.length - 1];
            if (!cl ||
                cl.t <= (strategyCandle.get(s.symbol) || 0) ||
                now - cl.end > 15000)
                continue;
            strategyCandle.set(s.symbol, cl.t);
            for (const h of HORIZONS) {
                const pick = lab.decide(s.symbol, h, closed);
                const decisionNow = market.rest.now();
                if (!pick || blocked(s.symbol, decisionNow) || market.reasons(s).length)
                    continue;
                const snapshot = freezeMarketState(s);
                const f = buildFeatures(snapshot, h, decisionNow, news.context(s.symbol, decisionNow, h), news.ready());
                const d = applyPaperFeedback(strategyDecision(f, pick, snapshot.trade.p, decisionNow), recent, decisionNow, config.PAYOUT);
                if (!d.signal) {
                    decisions.set(s.symbol, [
                        ...(decisions.get(s.symbol) || []).filter((x) => x.horizon !== h),
                        d,
                    ]);
                    await store.saveDecision(f, d);
                    continue;
                }
                await store.saveSignal(d.signal, true);
                signalsChanged = true;
                active.set(d.signal.id, d.signal);
                recent = [d.signal, ...recent].slice(0, 500);
                cooldowns.set(`${s.symbol}:${h}`, decisionNow);
                decisions.set(s.symbol, [
                    ...(decisions.get(s.symbol) || []).filter((x) => x.horizon !== h),
                    d,
                ]);
            }
        }
        if (robot && store.healthy) {
            robot.settle(market.rest.now(), priceOf, candleAt);
            for (const s of cycle)
                if (!market.reasons(s).length)
                    robot.onCandle(s.symbol, s.candles["1m"].filter((c) => c.end < now), priceOf, market.rest.now());
        }
        if (signalsChanged)
            stats = await store.stats();
        broadcast();
    }
    catch (e) {
        store.healthy = false;
        dbError = "FALHA NO CICLO — ANÁLISE BLOQUEADA";
        log.error({ err: e }, "scanner tick");
        broadcast();
    }
    finally {
        busy = false;
    }
}
let newsBusy = false;
async function newsTick() {
    if (!initialized || newsBusy || stopping)
        return;
    newsBusy = true;
    try {
        await news.poll();
        await news.reactions(market.rest.now());
        newsList = await news.list();
        newsCategories = await news.categories();
    }
    catch (e) {
        news.status = "ERRO NO PROCESSAMENTO DE NOTÍCIAS";
        log.error({ err: e }, "news tick");
    }
    finally {
        newsBusy = false;
    }
}
const timer = setInterval(() => void tick(), 1000), tickTimer = setInterval(liveTicks, 100), newsTimer = setInterval(() => void newsTick(), 30000);
server.listen(config.PORT, "0.0.0.0", () => log.info({ port: config.PORT }, "dashboard iniciado"));
void initialize()
    .then(() => newsTick())
    .catch((e) => {
    dbError = "FALHA NA INICIALIZAÇÃO — CONSULTE LOGS";
    log.fatal({ err: e }, "initialize");
    setTimeout(() => process.exit(1), 1000);
});
async function shutdown() {
    if (stopping)
        return;
    stopping = true;
    clearInterval(timer);
    clearInterval(tickTimer);
    clearInterval(newsTimer);
    market.stop();
    lab.stop();
    news.stop();
    for (const ws of wss.clients)
        ws.close(1001, "shutdown");
    wss.close();
    server.close();
    const deadline = setTimeout(() => process.exit(1), 10000);
    while (busy || newsBusy || backupBusy)
        await new Promise((r) => setTimeout(r, 50));
    await candleQueue;
    await store.close();
    clearTimeout(deadline);
    process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
