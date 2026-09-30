import { randomUUID } from "node:crypto";
import { buildSeries, catalog } from "./strategies.js";
import { priceContext } from "./price-context.js";
import { STRATEGY_HORIZONS } from "./types.js";
const specs = new Map(catalog().map((x) => [x.id, x]));
export const liveKey = (id, symbol, h) => `${id}|${symbol}|${h}`;
const fmt = (n) => n.toLocaleString("pt-BR", {
    maximumFractionDigits: n >= 1000 ? 2 : n >= 1 ? 4 : 6,
});
// Direction of a higher timeframe built from the 1m candles: price above EMA21 above EMA50 is up.
export function bias(closed, minutes) {
    const size = minutes * 60000, bars = [];
    for (const c of closed.slice(-minutes * 300)) {
        const t = Math.floor(c.t / size) * size, last = bars[bars.length - 1];
        if (last && last.t === t) {
            last.h = Math.max(last.h, c.h);
            last.l = Math.min(last.l, c.l);
            last.c = c.c;
            last.v += c.v;
            last.buy += c.buy;
            last.end = c.end;
        }
        else
            bars.push({ ...c, t });
    }
    if (bars.length < 60)
        return 0;
    const s = buildSeries(bars), i = s.c.length - 1;
    if (s.c[i] > s.ema21[i] && s.ema21[i] > s.ema50[i])
        return 1;
    if (s.c[i] < s.ema21[i] && s.ema21[i] < s.ema50[i])
        return -1;
    return 0;
}
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
    const b5 = bias(closed, 5), b15 = bias(closed, 15);
    // Never enter against the 5 or 15-minute trend, whatever the 1m trigger says.
    const against = (d) => (b5 && b5 !== d) || (b15 && b15 !== d);
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
            against: Boolean(against(d)),
        });
    }
    fired.sort((a, b) => Number(b.approved) - Number(a.approved) || b.score - a.score);
    const eligible = fired.filter((f) => !f.paused &&
        !f.against &&
        f.backtestTrades >= o.minTrades &&
        f.score >= o.minScore &&
        (!o.horizons || o.horizons.includes(f.horizon)));
    // Confirmation: other strategy families that fired the same way and are not losers in history.
    const agree = (f) => new Set(fired
        .filter((g) => g.direction === f.direction &&
        !g.against &&
        !g.paused &&
        g.score >= 0.5)
        .map((g) => g.id.split(":")[0])).size;
    const minAgree = o.minAgree ?? 1;
    let pick = null, why;
    if (!fired.length)
        why = "Nenhum gatilho disparou neste candle.";
    else if (fired.every((f) => f.against))
        why =
            "Gatilho disparou contra a tendência de 5/15 min; o robô fica de fora.";
    else if (!eligible.length)
        why = `Gatilho disparou, mas nenhum tem histórico acima do mínimo escolhido (${pctTxt(o.minScore)}).`;
    else if (eligible.some((f) => f.direction !== eligible[0].direction))
        why = "Gatilhos bons em direções opostas; o robô fica de fora.";
    else if (agree(eligible[0]) < minAgree)
        why = `Só ${agree(eligible[0])} estratégia confirma; o robô espera ${minAgree} concordando.`;
    else {
        pick = eligible[0];
        why = `Entrada em ${pick.direction === "COMPRA" ? "compra" : "venda"} com expiração de ${pick.horizon} min (${agree(pick)} estratégias concordam).`;
    }
    const lines = [
        trend === "LATERAL"
            ? x.range
                ? "Mercado lateral, preço dentro de uma faixa definida."
                : "Mercado sem tendência clara."
            : `Tendência de ${trend.toLowerCase()} (médias 9, 21 e 50 alinhadas).`,
    ];
    const biasTxt = (b) => b === 1 ? "alta" : b === -1 ? "baixa" : "lateral";
    lines.push(`Tendência maior: 5 min em ${biasTxt(b5)}, 15 min em ${biasTxt(b15)}.`);
    if (support != null)
        lines.push(`Suporte em ${fmt(support)} (${pctTxt((price - support) / price)} abaixo).`);
    if (resistance != null)
        lines.push(`Resistência em ${fmt(resistance)} (${pctTxt((resistance - price) / price)} acima).`);
    if (rsi != null)
        lines.push(`RSI 14 em ${rsi.toFixed(0)}${rsi >= 70 ? ", sobrecomprado" : rsi <= 30 ? ", sobrevendido" : ""}.`);
    for (const f of fired.slice(0, 3))
        lines.push(`Gatilho: ${f.label} (${f.direction.toLowerCase()}, ${f.horizon} min) — ${f.backtestWinRate == null ? "sem histórico" : `acertou ${pctTxt(f.backtestWinRate)} em ${f.backtestTrades} testes`}${f.liveTrades ? `; no robô ${f.liveWins}/${f.liveTrades}` : ""}.`);
    // How many of this pair's measured triggers are allowed to enter at the chosen strictness.
    const armed = evaluations.filter((e) => e.symbol === symbol &&
        (!o.horizons || o.horizons.includes(e.horizon)) &&
        e.outOfSample.wins + e.outOfSample.losses >= o.minTrades &&
        (e.outOfSample.wins + 1) /
            (e.outOfSample.wins + e.outOfSample.losses + 2) >=
            o.minScore).length, total = evaluations.filter((e) => e.symbol === symbol && (!o.horizons || o.horizons.includes(e.horizon))).length;
    if (total)
        lines.push(`Gatilhos liberados neste par: ${armed} de ${total} (histórico ≥ ${pctTxt(o.minScore)}).`);
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
const spDay = (t) => new Date(t).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
export const spHour = (t) => new Date(t).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false,
}) + "h";
// Where the robot's own record is below break-even (asset or São Paulo hour), it stops entering.
export function losingSpot(trades, symbol, now, breakEven, minTrades) {
    const hour = spHour(now), check = (ts, what) => {
        const w = ts.filter((t) => t.result === "WIN").length, l = ts.filter((t) => t.result === "LOSS").length;
        return w + l >= minTrades && w / (w + l) < breakEven
            ? `O robô está perdendo ${what} (${w} de ${w + l}, ${pctTxt(w / (w + l))}); fica de fora.`
            : null;
    }, done = trades.filter((t) => t.status === "FECHADA");
    return (check(done.filter((t) => t.symbol === symbol), "neste ativo") ??
        check(done.filter((t) => spHour(t.openedAt) === hour), `neste horário (${hour})`));
}
export function robotStats(trades, bankroll) {
    const done = trades.filter((t) => t.status === "FECHADA"), wins = done.filter((t) => t.result === "WIN").length, losses = done.filter((t) => t.result === "LOSS").length, profit = done.reduce((a, t) => a + (t.profit ?? 0), 0), day = spDay(Date.now()), today = done.filter((t) => spDay(t.openedAt) === day);
    const byHorizon = STRATEGY_HORIZONS.map((h) => {
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
// The Desempenho screen: the robot's closed trades, overall and grouped.
export function robotPerformance(trades, breakEven) {
    const done = trades
        .filter((t) => t.status === "FECHADA")
        .sort((a, b) => a.closedAt - b.closedAt);
    const summarize = (ts) => {
        const wins = ts.filter((t) => t.result === "WIN").length, losses = ts.filter((t) => t.result === "LOSS").length;
        let streak = 0, max = 0;
        for (const t of ts) {
            if (t.result === "EMPATE")
                continue;
            streak = t.result === "LOSS" ? streak + 1 : 0;
            max = Math.max(max, streak);
        }
        return {
            count: ts.length,
            wins,
            losses,
            neutrals: ts.length - wins - losses,
            winRate: wins + losses ? wins / (wins + losses) : null,
            maxLossStreak: max,
            profit: ts.reduce((a, t) => a + (t.profit ?? 0), 0),
        };
    };
    const grouped = (fn) => {
        const groups = {};
        for (const t of done)
            (groups[fn(t)] ??= []).push(t);
        return Object.fromEntries(Object.entries(groups)
            .sort((a, b) => b[1].length - a[1].length)
            .map(([k, v]) => [k, summarize(v)]));
    };
    return {
        ...summarize(done),
        open: trades.filter((t) => t.status === "ABERTA").length,
        breakEven,
        byAsset: grouped((t) => t.symbol),
        byHorizon: grouped((t) => `${t.horizon} min`),
        byHour: grouped((t) => spHour(t.openedAt)),
        byStrategy: grouped((t) => t.strategy),
    };
}
