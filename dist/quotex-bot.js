import { QuotexBot } from "./quotex/bot.js";
import { DEFAULT_CONFIG } from "./quotex/types.js";
import { log } from "./log.js";
// --- Configuration from environment ---
const email = process.env.QUOTEX_EMAIL;
const password = process.env.QUOTEX_PASSWORD;
const ssid = process.env.QUOTEX_SSID || undefined;
if (!email || !password) {
    console.error(`
╔══════════════════════════════════════════════════════╗
║  QUOTEX BOT — Configuracao                          ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  Defina as variaveis de ambiente:                    ║
║                                                      ║
║  QUOTEX_EMAIL=seu@email.com                          ║
║  QUOTEX_PASSWORD=sua_senha                           ║
║                                                      ║
║  Opcional (se login HTTP falhar):                    ║
║  QUOTEX_SSID=token_da_sessao                         ║
║                                                      ║
║  Para obter o SSID manualmente:                      ║
║  1. Abra quotex.com no navegador e faca login        ║
║  2. Abra DevTools (F12) > Console                    ║
║  3. Digite: window.settings.token                    ║
║  4. Copie o valor e defina QUOTEX_SSID               ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
`);
    process.exit(1);
}
const config = {
    ...DEFAULT_CONFIG,
    email,
    password,
    ssid,
    host: process.env.QUOTEX_HOST || DEFAULT_CONFIG.host,
    isDemo: process.env.QUOTEX_DEMO !== "false",
    minPayout: parseFloat(process.env.QUOTEX_MIN_PAYOUT || "") || DEFAULT_CONFIG.minPayout,
    expiration: parseInt(process.env.QUOTEX_EXPIRATION || "") || DEFAULT_CONFIG.expiration,
    startBalance: parseFloat(process.env.QUOTEX_START_BALANCE || "") || DEFAULT_CONFIG.startBalance,
    targetBalance: parseFloat(process.env.QUOTEX_TARGET_BALANCE || "") || DEFAULT_CONFIG.targetBalance,
    maxStakePct: parseFloat(process.env.QUOTEX_MAX_STAKE_PCT || "") || DEFAULT_CONFIG.maxStakePct,
    minStake: parseFloat(process.env.QUOTEX_MIN_STAKE || "") || DEFAULT_CONFIG.minStake,
    minConfluence: parseInt(process.env.QUOTEX_MIN_CONFLUENCE || "") || DEFAULT_CONFIG.minConfluence,
    cooldownMs: parseInt(process.env.QUOTEX_COOLDOWN_MS || "") || DEFAULT_CONFIG.cooldownMs,
    maxConsecLosses: parseInt(process.env.QUOTEX_MAX_CONSEC_LOSSES || "") || DEFAULT_CONFIG.maxConsecLosses,
    dailyLossLimit: parseFloat(process.env.QUOTEX_DAILY_LOSS_LIMIT || "") || DEFAULT_CONFIG.dailyLossLimit,
};
log.info({
    host: config.host,
    isDemo: config.isDemo,
    minPayout: `${(config.minPayout * 100).toFixed(0)}%`,
    expiration: `${config.expiration}s`,
    startBalance: `R$${config.startBalance}`,
    targetBalance: `R$${config.targetBalance}`,
    maxStakePct: `${(config.maxStakePct * 100).toFixed(0)}%`,
    minConfluence: config.minConfluence,
    ssidProvided: !!ssid,
}, "quotex-bot: iniciando");
console.log(`
╔══════════════════════════════════════════════════════╗
║  QUOTEX BOT — YOSH Trading System                   ║
╠══════════════════════════════════════════════════════╣
║  Modo: ${config.isDemo ? "DEMO (simulacao)" : "REAL (dinheiro real)"}${" ".repeat(config.isDemo ? 15 : 10)}║
║  Saldo inicial: R$${config.startBalance.toFixed(2).padEnd(32)}║
║  Meta: R$${config.targetBalance.toFixed(2).padEnd(42)}║
║  Payout minimo: ${(config.minPayout * 100).toFixed(0)}%${" ".repeat(34)}║
║  Expiracao: ${config.expiration}s (${(config.expiration / 60).toFixed(0)} min)${" ".repeat(28)}║
║  Stake maximo: ${(config.maxStakePct * 100).toFixed(0)}% do saldo${" ".repeat(24)}║
║  Confluencia minima: ${config.minConfluence} sinais${" ".repeat(22)}║
╚══════════════════════════════════════════════════════╝
`);
const bot = new QuotexBot(config);
// Graceful shutdown
process.on("SIGINT", () => {
    log.info("quotex-bot: SIGINT recebido, parando...");
    bot.stop();
    setTimeout(() => process.exit(0), 2000);
});
process.on("SIGTERM", () => {
    log.info("quotex-bot: SIGTERM recebido, parando...");
    bot.stop();
    setTimeout(() => process.exit(0), 2000);
});
// Status report every 5 minutes
setInterval(() => {
    const s = bot.getStatus();
    log.info(s, `quotex-bot: [STATUS] ${s.status} | R$${s.balance.toFixed(2)} | ${s.wins}W/${s.losses}L (${s.winRate.toFixed(1)}%) | hoje: R$${s.todayPnl.toFixed(2)}`);
}, 300_000);
bot.start().catch((err) => {
    log.error({ err }, "quotex-bot: erro fatal");
    process.exit(1);
});
