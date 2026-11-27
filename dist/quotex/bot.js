import { QuotexClient } from "./client.js";
import { loginHttp } from "./auth.js";
import { analyzeCandles } from "./analysis.js";
import { newBankrollState, updateBalance, calculateStake, shouldTrade, } from "./bankroll.js";
import { thinkDelay, scanDelay, resultDelay, distractionPause, shouldDistract, jitter, isActiveHour, } from "./human.js";
import { log } from "../log.js";
export class QuotexBot {
    client = null;
    config;
    bank;
    status = "connecting";
    running = false;
    cooldowns = new Map();
    tradeLog = [];
    activeTrade = null;
    constructor(config) {
        this.config = config;
        this.bank = newBankrollState(config);
    }
    async start() {
        this.running = true;
        this.status = "connecting";
        // Authenticate
        let ssid = this.config.ssid;
        let host = this.config.host;
        let cookies = "";
        const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
        if (!ssid) {
            log.info("quotex-bot: tentando login HTTP...");
            const login = await loginHttp(this.config.email, this.config.password, host);
            if (!login) {
                log.error("quotex-bot: login falhou. Defina QUOTEX_SSID manualmente (ver instrucoes).");
                this.status = "stopped";
                return;
            }
            ssid = login.ssid;
            host = login.host;
            cookies = login.cookies;
        }
        // Connect WebSocket
        const opts = {
            ssid,
            host,
            cookies,
            userAgent: ua,
            isDemo: this.config.isDemo,
        };
        this.client = new QuotexClient(opts);
        this.client.on("balance", (bal) => {
            this.bank.balance = bal;
            log.info({ balance: bal }, "quotex-bot: saldo atualizado");
        });
        this.client.on("trade-result", (r) => {
            this.tradeLog.push(r);
            this.bank = updateBalance(this.bank, r.profit, r.win);
            this.activeTrade = null;
            const emoji = r.win ? "WIN" : "LOSS";
            log.info({
                result: emoji,
                asset: r.asset,
                direction: r.direction,
                profit: r.profit,
                balance: this.bank.balance,
                streak: this.bank.streak,
                winRate: this.bank.wins + this.bank.losses > 0
                    ? ((this.bank.wins / (this.bank.wins + this.bank.losses)) * 100).toFixed(1)
                    : "—",
            }, `quotex-bot: ${emoji} ${r.asset} ${r.direction} | lucro: R$${r.profit.toFixed(2)} | saldo: R$${this.bank.balance.toFixed(2)}`);
        });
        this.client.on("fatal", () => {
            this.running = false;
            this.status = "stopped";
        });
        this.client.on("reconnected", () => {
            log.info("quotex-bot: reconectado");
            this.client.requestAssets();
            this.client.requestBalance();
        });
        try {
            await this.client.connect();
            log.info("quotex-bot: conectado e autorizado");
        }
        catch (err) {
            log.error({ err: err.message }, "quotex-bot: falha na conexao");
            this.status = "stopped";
            return;
        }
        // Request initial data
        this.client.requestAssets();
        this.client.requestBalance();
        await new Promise((r) => setTimeout(r, 3000));
        // Main loop
        await this.mainLoop();
    }
    stop() {
        this.running = false;
        this.status = "stopped";
        this.client?.disconnect();
        log.info({
            balance: this.bank.balance,
            wins: this.bank.wins,
            losses: this.bank.losses,
            trades: this.tradeLog.length,
        }, "quotex-bot: parado");
    }
    async mainLoop() {
        while (this.running) {
            try {
                // Check if we should trade
                const check = shouldTrade(this.bank, this.config);
                if (!check.ok) {
                    log.info({ reason: check.reason }, "quotex-bot: nao operando");
                    if (this.bank.balance >= this.config.targetBalance) {
                        this.status = "target_reached";
                        log.info(`quotex-bot: META ATINGIDA! R$${this.bank.balance.toFixed(2)}`);
                        this.stop();
                        return;
                    }
                    this.status = "paused";
                    await new Promise((r) => setTimeout(r, jitter(60000)));
                    continue;
                }
                // Check active hours
                if (!isActiveHour()) {
                    this.status = "waiting";
                    log.info("quotex-bot: fora do horario ativo");
                    await new Promise((r) => setTimeout(r, jitter(300000)));
                    continue;
                }
                // Skip if already in a trade
                if (this.activeTrade) {
                    await new Promise((r) => setTimeout(r, jitter(5000)));
                    continue;
                }
                // Random distraction pause
                if (shouldDistract()) {
                    log.info("quotex-bot: pausa aleatoria (simulando humano)");
                    await distractionPause();
                }
                this.status = "scanning";
                // Find best opportunity
                const signal = await this.findSignal();
                if (!signal) {
                    this.status = "waiting";
                    await new Promise((r) => setTimeout(r, jitter(30000)));
                    continue;
                }
                // Execute trade
                await this.executeTrade(signal);
            }
            catch (err) {
                log.error({ err: err.message }, "quotex-bot: erro no loop principal");
                await new Promise((r) => setTimeout(r, jitter(10000)));
            }
        }
    }
    async findSignal() {
        if (!this.client)
            return null;
        const assets = this.client
            .getAssets()
            .filter((a) => a.isOpen &&
            !a.isSuspended &&
            a.payout >= this.config.minPayout)
            .sort((a, b) => b.payout - a.payout);
        if (assets.length === 0) {
            log.info("quotex-bot: nenhum ativo com payout minimo");
            return null;
        }
        log.info({ count: assets.length, top: assets.slice(0, 5).map((a) => `${a.name}(${(a.payout * 100).toFixed(0)}%)`) }, "quotex-bot: escaneando ativos");
        let bestSignal = null;
        let bestScore = 0;
        for (const asset of assets.slice(0, 15)) {
            // Cooldown check
            const lastTrade = this.cooldowns.get(asset.name);
            if (lastTrade && Date.now() - lastTrade < this.config.cooldownMs)
                continue;
            // Subscribe to get candles if we don't have enough
            const candles = this.client.getCandles(String(asset.id));
            if (candles.length < 50) {
                this.client.subscribeAsset(asset.id);
                await scanDelay();
                continue;
            }
            // Analyze
            const result = analyzeCandles(candles, asset.name);
            if (result.direction && result.confidence >= this.config.minConfluence) {
                // Weight by payout: higher payout assets get a boost
                const score = result.confidence * (1 + asset.payout);
                if (score > bestScore) {
                    bestScore = score;
                    bestSignal = {
                        asset: asset.name,
                        assetId: asset.id,
                        direction: result.direction,
                        confidence: result.confidence,
                        reasons: result.reasons,
                        timestamp: Date.now(),
                    };
                }
            }
            await scanDelay();
        }
        if (bestSignal) {
            log.info({
                asset: bestSignal.asset,
                direction: bestSignal.direction,
                confidence: bestSignal.confidence,
                reasons: bestSignal.reasons,
            }, "quotex-bot: sinal encontrado");
        }
        return bestSignal;
    }
    async executeTrade(signal) {
        if (!this.client?.isConnected)
            return;
        this.status = "trading";
        // Human thinking delay before entering
        await thinkDelay();
        // Calculate stake
        const stake = calculateStake(this.bank, this.config);
        if (stake <= 0) {
            log.warn("quotex-bot: stake calculado como zero");
            return;
        }
        this.activeTrade = signal.asset;
        this.cooldowns.set(signal.asset, Date.now());
        log.info({
            asset: signal.asset,
            direction: signal.direction,
            stake,
            expiration: this.config.expiration,
            confidence: signal.confidence,
            reasons: signal.reasons.join(" | "),
        }, `quotex-bot: ENTRANDO ${signal.direction.toUpperCase()} ${signal.asset} | R$${stake.toFixed(2)} | ${signal.reasons.length} confirmacoes`);
        try {
            const result = await this.client.buy(signal.assetId, signal.asset, signal.direction, stake, this.config.expiration);
            // Result is handled by the trade-result event listener
            await resultDelay();
        }
        catch (err) {
            log.error({ err: err.message, asset: signal.asset }, "quotex-bot: erro ao executar trade");
            this.activeTrade = null;
        }
    }
    getStatus() {
        return {
            status: this.status,
            balance: this.bank.balance,
            target: this.bank.targetBalance,
            wins: this.bank.wins,
            losses: this.bank.losses,
            streak: this.bank.streak,
            todayPnl: this.bank.todayPnl,
            todayTrades: this.bank.todayTradeCount,
            winRate: this.bank.wins + this.bank.losses > 0
                ? (this.bank.wins / (this.bank.wins + this.bank.losses)) * 100
                : 0,
            activeTrade: this.activeTrade,
            trades: this.tradeLog.length,
        };
    }
}
