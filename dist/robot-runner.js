import { config, staleMs } from "./config.js";
import { log } from "./log.js";
import { ROBOT_DEFAULT_HORIZONS, STRATEGY_HORIZONS, } from "./types.js";
import { RobotAI } from "./robot-ai.js";
import { liveKey, newTrade, readMarket, robotStats, settleTrade, robotPerformance, } from "./robot.js";
export const ROBOT_LEVELS = ["alta", "media", "baixa"];
// Runs the simulated operator: one open trade per asset, settles at expiry from the live price.
export class Robot {
    db;
    lab;
    clock;
    enabled = config.ROBOT_ENABLED;
    // Expiries the robot may use; chosen on the chart screen and kept across restarts.
    horizons = [...ROBOT_DEFAULT_HORIZONS];
    // How good a trigger's history must be to enter; chosen on the chart screen.
    level = "media";
    trades = [];
    reads = new Map();
    status = "AGUARDANDO HISTÓRICO DO LABORATÓRIO";
    ai = new RobotAI(config.ANTHROPIC_API_KEY, config.ROBOT_AI_MODEL, config.ROBOT_AI_MAX_PER_HOUR);
    seen = new Map();
    busy = new Set();
    constructor(db, lab, clock = Date.now) {
        this.db = db;
        this.lab = lab;
        this.clock = clock;
    }
    get breakEven() {
        return 1 / (1 + config.PAYOUT);
    }
    options() {
        return {
            breakEven: this.breakEven,
            minTrades: config.ROBOT_MIN_TRADES,
            minScore: config.ROBOT_MIN_WINRATE || this.levelScore(),
            horizons: this.horizons,
        };
    }
    levelScore() {
        // Alta: 3 points above break-even; Média: break-even; Baixa: not a loser in history.
        return this.level === "alta"
            ? this.breakEven + 0.03
            : this.level === "media"
                ? this.breakEven
                : 0.5;
    }
    setLevel(level) {
        this.level = level;
        this.db.query("INSERT INTO robot_settings(key,value) VALUES('level',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(level)]);
    }
    // Trades left open by a restart are settled by settle() from the reloaded candles.
    setHorizons(list) {
        this.horizons = STRATEGY_HORIZONS.filter((h) => list.includes(h));
        if (!this.horizons.length)
            this.horizons = [...ROBOT_DEFAULT_HORIZONS];
        this.db.query("INSERT INTO robot_settings(key,value) VALUES('horizons',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(this.horizons)]);
    }
    setEnabled(on) {
        this.enabled = on;
        this.status = on ? "PROCURANDO OPORTUNIDADE" : "PAUSADO";
        this.db.query("INSERT INTO robot_settings(key,value) VALUES('enabled',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(on)]);
    }
    load() {
        for (const r of this.db.query("SELECT key,value FROM robot_settings")
            .rows) {
            try {
                const v = JSON.parse(String(r.value));
                if (r.key === "horizons" && Array.isArray(v))
                    this.horizons = STRATEGY_HORIZONS.filter((h) => v.includes(h));
                if (r.key === "enabled" && typeof v === "boolean")
                    this.enabled = v;
                if (r.key === "level" &&
                    ROBOT_LEVELS.includes(v))
                    this.level = v;
            }
            catch {
                /* ignore a corrupt setting */
            }
        }
        if (!this.horizons.length)
            this.horizons = [...ROBOT_DEFAULT_HORIZONS];
        this.trades = this.db
            .query("SELECT body FROM robot_trades ORDER BY opened_at DESC LIMIT 3000")
            .rows.map((r) => typeof r.body === "string" ? JSON.parse(r.body) : r.body);
    }
    save(t) {
        this.db.query("INSERT INTO robot_trades(id,symbol,opened_at,status,body) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status, body=EXCLUDED.body", [t.id, t.symbol, t.openedAt, t.status, JSON.stringify(t)]);
        this.trades = [t, ...this.trades.filter((x) => x.id !== t.id)].slice(0, 3000);
    }
    live() {
        const m = new Map();
        for (const t of this.trades) {
            if (t.status !== "FECHADA" || t.result === "EMPATE")
                continue;
            const k = liveKey(t.strategyId, t.symbol, t.horizon), r = m.get(k) ?? { wins: 0, trades: 0 };
            r.trades++;
            if (t.result === "WIN")
                r.wins++;
            m.set(k, r);
        }
        return m;
    }
    get open() {
        return this.trades.filter((t) => t.status === "ABERTA");
    }
    read(symbol, closed) {
        return readMarket(symbol, closed, this.lab.evaluations, this.live(), this.options());
    }
    // Called every second: closes trades whose expiry has passed.
    settle(now, priceOf, candleAt) {
        let changed = false;
        for (const t of this.open) {
            if (now < t.due)
                continue;
            const q = priceOf(t.symbol);
            if (q && q.t >= t.due && q.t - t.due <= 30000) {
                this.save(settleTrade(t, q.p, q.t));
                changed = true;
                continue;
            }
            if (now < t.due + 90000)
                continue;
            // Live price missed the expiry (restart or feed gap): use the 1m candle that contains it.
            const c = candleAt(t.symbol, t.due);
            this.save(c
                ? {
                    ...settleTrade(t, c.c, c.end),
                    note: "Saída pelo fechamento do candle do vencimento",
                }
                : {
                    ...t,
                    status: "CANCELADA",
                    note: "Sem cotação no vencimento",
                });
            changed = true;
        }
        return changed;
    }
    // Called once per closed 1m candle of each asset.
    onCandle(symbol, closed, priceOf, now) {
        const last = closed[closed.length - 1];
        if (!last || last.t <= (this.seen.get(symbol) ?? 0))
            return;
        this.seen.set(symbol, last.t);
        const read = this.read(symbol, closed);
        if (!read)
            return;
        // Without the backtest table the robot still reads the chart but never enters.
        if (!this.lab.evaluations.length) {
            this.status = `AGUARDANDO LABORATÓRIO: ${this.lab.status}`;
            this.reads.set(symbol, {
                ...read,
                why: "Lendo o gráfico; entradas liberadas quando o backtest terminar.",
            });
            return;
        }
        this.reads.set(symbol, read);
        this.status = this.enabled
            ? this.open.length
                ? `OPERANDO (${this.open.length} ABERTA${this.open.length > 1 ? "S" : ""})`
                : "PROCURANDO OPORTUNIDADE"
            : "PAUSADO";
        const pick = read.pick;
        if (!this.enabled ||
            !pick ||
            this.busy.has(symbol) ||
            this.open.some((t) => t.symbol === symbol) ||
            this.open.length >= config.ROBOT_MAX_OPEN)
            return;
        const lastOnSymbol = this.trades.find((t) => t.symbol === symbol);
        if (lastOnSymbol &&
            now < lastOnSymbol.openedAt + lastOnSymbol.horizon * 60000)
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
                const q = priceOf(symbol), at = this.clock();
                // The opportunity is only valid right after the candle closed.
                if (!q || at - last.end > 45000 || at - q.t > staleMs(symbol))
                    return;
                if (this.open.some((t) => t.symbol === symbol))
                    return;
                this.save(newTrade(read, pick, q.p, at, config.ROBOT_STAKE, config.PAYOUT, review
                    ? {
                        model: this.ai.model,
                        confidence: review.confidence,
                        reason: review.reason,
                    }
                    : null));
            }
            catch (e) {
                log.error({ err: e }, "robô");
            }
            finally {
                this.busy.delete(symbol);
            }
        })();
    }
    brief() {
        return {
            enabled: this.enabled,
            horizons: this.horizons,
            level: this.level,
            minScore: this.options().minScore,
            status: this.status,
            stats: robotStats(this.trades, config.ROBOT_BANKROLL),
            open: this.open,
            last: this.trades.filter((t) => t.status !== "ABERTA").slice(0, 5),
        };
    }
    performance() {
        return robotPerformance(this.trades, this.breakEven);
    }
    summary() {
        return {
            ...this.brief(),
            breakEven: this.breakEven,
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
