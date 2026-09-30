import { randomUUID } from "node:crypto";
import { buildSeries, catalog } from "./strategies.js";
import { priceContext } from "./price-context.js";
import { HORIZONS } from "./types.js";
const specs = new Map(catalog().map((x) => [x.id, x]));
export const liveKey = (id, symbol, h) => `${id}|${symbol}|${h}`;
const fmt = (n) => n.toLocaleString("pt-BR", {
    maximumFractionDigits: n >= 1000 ? 2 : n >= 1 ? 4 : 6,
});
const pctTxt = (n) => `${(n * 100).toFixed(1).replace(".", ",")}%`;
// Pure: everything the robot decides comes from closed candles, the backtest table and its own record.
export function readMarket(symbol, closed, evaluations, live, o) {
    if (closed.length < 400)
        return null;
    const s = buildSeries(closed.slice(-1500)), i = s.c.length - 1, x = priceContext(s, i), price = s.c[i], atr = s.atr[i];
    const trend = x.trend === 1 ? "ALTA" : x.trend === -1 ? "BAIXA" : "LATERAL", support = Number.isFinite(s.sup[i])
        ? s.sup[i]
        : Number.isFinite(x.support)
            ? x.support
            : null, resistance = Number.isFinite(s.res[i])
        ? s.res[i]
        : Number.isFinite(x.resistance)
            ? x.resistance
            : null, rsi = Number.isFinite(s.rsi14[i]) ? s.rsi14[i] : null;
    const fired = [];
    for (const e of evaluations) {
        if (e.symbol !== symbol)
            continue;
        const d = specs.get(e.id)?.signal(s, i) ?? 0;
        if (!d)
            continue;
        const r = live.get(liveKey(e.id, symbol, e.horizon)) ?? {
            wins: 0,
            trades: 0,
        }, btN = e.outOfSample.wins + e.outOfSample.losses, btW = e.outOfSample.wins;
        fired.push({
            id: e.id,
            label: e.label,
            horizon: e.horizon,
            direction: d === 1 ? "COMPRA" : "VENDA",
            approved: e.approved,
            backtestWins: btW,
            backtestTrades: btN,
            backtestWinRate: e.outOfSample.winRate,
            liveWins: r.wins,
            liveTrades: r.trades,
            // Backtest and the robot's own results pooled; a small sample is pulled toward 50%.
            score: (btW + r.wins + 1) / (btN + r.trades + 2),
            paused: r.trades >= 10 && r.wins / r.trades < o.breakEven - 0.05,
        });
    }
    fired.sort((a, b) => Number(b.approved) - Number(a.approved) || b.score - a.score);
    const eligible = fired.filter((f) => !f.paused && f.backtestTrades >= o.minTrades && f.score >= o.minScore);
    let pick = null, why;
    if (!fired.length)
        why = "Nenhum gatilho disparou neste candle.";
    else if (!eligible.length)
        why = `Gatilho disparou, mas nenhum tem histórico acima do equilíbrio (${pctTxt(o.minScore)}).`;
    else if (eligible.some((f) => f.direction !== eligible[0].direction))
        why = "Gatilhos bons em direções opostas; o robô fica de fora.";
    else {
        pick = eligible[0];
        why = `Entrada em ${pick.direction === "COMPRA" ? "compra" : "venda"} com expiração de ${pick.horizon} min.`;
    }
    const lines = [
        trend === "LATERAL"
            ? x.range
                ? "Mercado lateral, preço dentro de uma faixa definida."
                : "Mercado sem tendência clara."
            : `Tendência de ${trend.toLowerCase()} (médias 9, 21 e 50 alinhadas).`,
    ];
    if (support != null)
        lines.push(`Suporte em ${fmt(support)} (${pctTxt((price - support) / price)} abaixo).`);
    if (resistance != null)
        lines.push(`Resistência em ${fmt(resistance)} (${pctTxt((resistance - price) / price)} acima).`);
    if (rsi != null)
        lines.push(`RSI 14 em ${rsi.toFixed(0)}${rsi >= 70 ? ", sobrecomprado" : rsi <= 30 ? ", sobrevendido" : ""}.`);
    for (const f of fired.slice(0, 3))
        lines.push(`Gatilho: ${f.label} (${f.direction.toLowerCase()}, ${f.horizon} min) — ${f.backtestWinRate == null ? "sem histórico" : `acertou ${pctTxt(f.backtestWinRate)} em ${f.backtestTrades} testes`}${f.liveTrades ? `; no robô ${f.liveWins}/${f.liveTrades}` : ""}.`);
    lines.push(why);
    return {
        symbol,
        t: s.t[i] + 59999,
        price,
        trend,
        range: x.range,
        support,
        resistance,
        rsi,
        atrPct: Number.isFinite(atr) ? atr / price : null,
        fired,
        pick,
        why,
        lines,
    };
}
// Binary-option settlement: the direction wins if the price moved its way, equal price refunds.
export function settleTrade(t, exit, at) {
    const move = (exit - t.entry) * (t.direction === "COMPRA" ? 1 : -1), result = move > 0 ? "WIN" : move < 0 ? "LOSS" : "EMPATE";
    return {
        ...t,
        status: "FECHADA",
        exit,
        closedAt: at,
        result,
        profit: result === "WIN" ? t.stake * t.payout : result === "LOSS" ? -t.stake : 0,
    };
}
export function robotStats(trades, bankroll) {
    const done = trades.filter((t) => t.status === "FECHADA"), wins = done.filter((t) => t.result === "WIN").length, losses = done.filter((t) => t.result === "LOSS").length, profit = done.reduce((a, t) => a + (t.profit ?? 0), 0), day = new Date().toISOString().slice(0, 10), today = done.filter((t) => new Date(t.openedAt).toISOString().slice(0, 10) === day);
    const byHorizon = HORIZONS.map((h) => {
        const r = done.filter((t) => t.horizon === h), w = r.filter((t) => t.result === "WIN").length, l = r.filter((t) => t.result === "LOSS").length;
        return {
            horizon: h,
            wins: w,
            losses: l,
            winRate: w + l ? w / (w + l) : null,
        };
    });
    let streak = 0;
    for (const t of [...done].sort((a, b) => b.closedAt - a.closedAt)) {
        if (t.result === "EMPATE")
            continue;
        const s = t.result === "WIN" ? 1 : -1;
        if (streak && Math.sign(streak) !== s)
            break;
        streak += s;
    }
    return {
        trades: done.length,
        wins,
        losses,
        ties: done.length - wins - losses,
        winRate: wins + losses ? wins / (wins + losses) : null,
        profit,
        balance: bankroll + profit,
        bankroll,
        todayTrades: today.length,
        todayProfit: today.reduce((a, t) => a + (t.profit ?? 0), 0),
        streak,
        byHorizon,
    };
}
export function newTrade(read, pick, entry, now, stake, payout, ai) {
    return {
        id: randomUUID(),
        symbol: read.symbol,
        horizon: pick.horizon,
        direction: pick.direction,
        strategyId: pick.id,
        strategy: pick.label,
        score: pick.score,
        backtestWinRate: pick.backtestWinRate,
        openedAt: now,
        entry,
        due: now + pick.horizon * 60000,
        stake,
        payout,
        status: "ABERTA",
        reading: read.lines,
        ai,
    };
}
