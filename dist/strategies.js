export const WARMUP = 300;
function ema(a, n, alpha = 2 / (n + 1)) {
    const out = new Float64Array(a.length).fill(NaN);
    if (a.length < n)
        return out;
    let s = 0;
    for (let i = 0; i < n; i++)
        s += a[i];
    out[n - 1] = s / n;
    for (let i = n; i < a.length; i++)
        out[i] = alpha * a[i] + (1 - alpha) * out[i - 1];
    return out;
}
function rsi(c, n) {
    const out = new Float64Array(c.length).fill(NaN);
    let g = 0, l = 0;
    for (let i = 1; i < c.length; i++) {
        const d = c[i] - c[i - 1], up = Math.max(0, d), dn = Math.max(0, -d);
        if (i <= n) {
            g += up / n;
            l += dn / n;
            if (i < n)
                continue;
        }
        else {
            g = (g * (n - 1) + up) / n;
            l = (l * (n - 1) + dn) / n;
        }
        out[i] = l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l);
    }
    return out;
}
function rolling(a, n) {
    const mean = new Float64Array(a.length).fill(NaN), std = new Float64Array(a.length).fill(NaN);
    let s = 0, q = 0;
    for (let i = 0; i < a.length; i++) {
        s += a[i];
        q += a[i] * a[i];
        if (i >= n) {
            s -= a[i - n];
            q -= a[i - n] * a[i - n];
        }
        if (i >= n - 1) {
            const m = s / n;
            mean[i] = m;
            std[i] = Math.sqrt(Math.max(0, q / n - m * m));
        }
    }
    return { mean, std };
}
export function buildSeries(cs) {
    const n = cs.length, f = (k) => Float64Array.from(cs, (x) => x[k]);
    const t = f("t"), o = f("o"), h = f("h"), l = f("l"), c = f("c"), v = f("v"), buy = f("buy");
    const tr = new Float64Array(n);
    for (let i = 0; i < n; i++)
        tr[i] = i
            ? Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))
            : h[i] - l[i];
    const ret = new Float64Array(n);
    for (let i = 1; i < n; i++)
        ret[i] = c[i] / c[i - 1] - 1;
    const bb = rolling(c, 20), vol = rolling(ret, 120), va = rolling(v, 60);
    const vwap = new Float64Array(n);
    let day = -1, pv = 0, vs = 0;
    for (let i = 0; i < n; i++) {
        const d = Math.floor(t[i] / 86400000);
        if (d !== day) {
            day = d;
            pv = 0;
            vs = 0;
        }
        pv += ((h[i] + l[i] + c[i]) / 3) * v[i];
        vs += v[i];
        vwap[i] = vs ? pv / vs : c[i];
    }
    return {
        t,
        o,
        h,
        l,
        c,
        v,
        buy,
        rsi7: rsi(c, 7),
        rsi14: rsi(c, 14),
        ema9: ema(c, 9),
        ema21: ema(c, 21),
        ema50: ema(c, 50),
        bbMid: bb.mean,
        bbStd: bb.std,
        atr: ema(tr, 14, 1 / 14),
        vwap,
        sigma: vol.std,
        volAvg: va.mean,
    };
}
const sgn = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
// Each family is tested both ways ("seguir" follows the move, "reverter" fades it); the data decides.
function both(family, key, label, base) {
    return [
        {
            id: `${family}:${key}:seguir`,
            family,
            label: `${label} · seguir`,
            signal: base,
        },
        {
            id: `${family}:${key}:reverter`,
            family,
            label: `${label} · reverter`,
            signal: (s, i) => (-base(s, i) || 0),
        },
    ];
}
export function catalog() {
    const out = [];
    for (const n of [7, 14])
        for (const lv of [20, 25, 30])
            out.push(...both("rsi", `${n}-${lv}`, `RSI(${n}) fora de ${lv}/${100 - lv}`, (s, i) => {
                const r = n === 7 ? s.rsi7[i] : s.rsi14[i];
                return r > 100 - lv ? 1 : r < lv ? -1 : 0;
            }));
    for (const k of [2, 2.5, 3])
        out.push(...both("bollinger", String(k), `Fechamento fora da Bollinger(20, ${k})`, (s, i) => {
            const d = s.c[i] - s.bbMid[i];
            return Math.abs(d) > k * s.bbStd[i] ? sgn(d) : 0;
        }));
    for (const m of [3, 5, 10])
        for (const z of [1.5, 2.5])
            out.push(...both("impulso", `${m}-${z}`, `Impulso de ${m} min acima de ${z}σ`, (s, i) => {
                if (i < m)
                    return 0;
                const r = s.c[i] / s.c[i - m] - 1;
                return Math.abs(r) > z * s.sigma[i] * Math.sqrt(m) ? sgn(r) : 0;
            }));
    for (const n of [4, 5, 6])
        out.push(...both("sequencia", String(n), `${n} candles seguidos na mesma cor`, (s, i) => {
            if (i < n)
                return 0;
            const d = sgn(s.c[i] - s.o[i]);
            if (!d)
                return 0;
            for (let j = 1; j < n; j++)
                if (sgn(s.c[i - j] - s.o[i - j]) !== d)
                    return 0;
            return d;
        }));
    for (const tol of [0, 0.25])
        out.push(...both("pullback", String(tol), `Pullback na EMA21 com tendência (tol ${tol} ATR)`, (s, i) => {
            const up = s.ema9[i] > s.ema21[i] && s.ema21[i] > s.ema50[i], dn = s.ema9[i] < s.ema21[i] && s.ema21[i] < s.ema50[i], tl = tol * s.atr[i];
            if (up && s.l[i] <= s.ema21[i] + tl && s.c[i] > s.ema21[i])
                return 1;
            if (dn && s.h[i] >= s.ema21[i] - tl && s.c[i] < s.ema21[i])
                return -1;
            return 0;
        }));
    for (const k of [3, 5, 8])
        out.push(...both("vwap", String(k), `Distância da VWAP acima de ${k} ATR`, (s, i) => {
            const d = (s.c[i] - s.vwap[i]) / s.atr[i];
            return Math.abs(d) > k ? sgn(d) : 0;
        }));
    for (const k of [3, 5])
        for (const x of [0.1, 0.15])
            out.push(...both("fluxo", `${k}-${x}`, `Fluxo agressor ${k} min > ${Math.round((0.5 + x) * 100)}% com volume 1,5x`, (s, i) => {
                if (i < k)
                    return 0;
                let b = 0, v = 0;
                for (let j = 0; j < k; j++) {
                    b += s.buy[i - j];
                    v += s.v[i - j];
                }
                if (!v || v / k < 1.5 * s.volAvg[i])
                    return 0;
                const r = b / v - 0.5;
                return Math.abs(r) > x ? sgn(r) : 0;
            }));
    for (const k of [2, 3])
        out.push(...both("exaustao", String(k), `Candle com amplitude > ${k} ATR`, (s, i) => s.h[i] - s.l[i] > k * s.atr[i - 1] ? sgn(s.c[i] - s.o[i]) : 0));
    for (const lv of [20, 25])
        out.push(...both("rsi-bollinger", String(lv), `RSI(7) fora de ${lv}/${100 - lv} + Bollinger(20, 2)`, (s, i) => {
            const d = s.c[i] - s.bbMid[i];
            if (Math.abs(d) <= 2 * s.bbStd[i])
                return 0;
            return d > 0 && s.rsi7[i] > 100 - lv
                ? 1
                : d < 0 && s.rsi7[i] < lv
                    ? -1
                    : 0;
        }));
    return out;
}
// One-sided Wilson lower bound of the win rate.
export function wilson(wins, n, z) {
    if (!n)
        return null;
    const p = wins / n, d = 1 + (z * z) / n;
    return ((p +
        (z * z) / (2 * n) -
        z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) /
        d);
}
export function tally(wins, losses, ties, z) {
    const n = wins + losses;
    return {
        trades: n + ties,
        wins,
        losses,
        ties,
        winRate: n ? wins / n : null,
        lower: wilson(wins, n, z),
    };
}
// Mirrors live paper constraints: one position per symbol/horizon, cooldown after each signal,
// entry at the signal candle close, exit h minutes later, any favourable move wins (binary option).
export function backtest(s, spec, h, from, to, cooldownBars, z, split) {
    const w = [0, 0], l = [0, 0], e = [0, 0];
    let next = from;
    for (let i = Math.max(from, WARMUP); i < to - h; i++) {
        if (i < next)
            continue;
        if (s.t[i + h] - s.t[i] !== h * 60000)
            continue;
        const d = spec.signal(s, i);
        if (!d)
            continue;
        const r = (s.c[i + h] / s.c[i] - 1) * d, k = split !== undefined && i >= split ? 1 : 0;
        if (r > 0)
            w[k]++;
        else if (r < 0)
            l[k]++;
        else
            e[k]++;
        next = i + Math.max(h, cooldownBars);
    }
    return {
        all: tally(w[0] + w[1], l[0] + l[1], e[0] + e[1], z),
        halves: [tally(w[0], l[0], e[0], z), tally(w[1], l[1], e[1], z)],
    };
}
// For each family: pick parameters on the in-sample slice, then judge once on the out-of-sample slice.
export function evaluateSymbol(symbol, s, horizons, o, specs = catalog()) {
    const n = s.c.length, split = Math.floor(WARMUP + (n - WARMUP) * o.inSampleShare), mid = Math.floor((split + n) / 2), out = [];
    const families = [...new Set(specs.map((x) => x.family))];
    for (const h of horizons)
        for (const family of families) {
            let best;
            for (const spec of specs.filter((x) => x.family === family)) {
                const is = backtest(s, spec, h, WARMUP, split, o.cooldownBars, o.z).all;
                if (is.trades < Math.max(30, o.minTrades / 2))
                    continue;
                if (!best || (is.lower ?? 0) > (best.is.lower ?? 0))
                    best = { spec, is };
            }
            if (!best)
                continue;
            const r = backtest(s, best.spec, h, split, n, o.cooldownBars, o.z, mid), oos = r.all, wr = oos.winRate ?? 0;
            const reason = oos.trades < o.minTrades
                ? `POUCAS OPERAÇÕES FORA DA AMOSTRA (${oos.trades} < ${o.minTrades})`
                : (oos.lower ?? 0) <= o.breakEven
                    ? wr > o.breakEven
                        ? "ACIMA DO BREAK-EVEN, MAS SEM SIGNIFICÂNCIA ESTATÍSTICA"
                        : "ABAIXO DO BREAK-EVEN FORA DA AMOSTRA"
                    : r.halves.some((x) => (x.winRate ?? 0) <= o.breakEven)
                        ? "INSTÁVEL: UMA METADE DO TESTE FICOU ABAIXO DO BREAK-EVEN"
                        : "APROVADA";
            out.push({
                symbol,
                horizon: h,
                id: best.spec.id,
                family,
                label: best.spec.label,
                inSample: best.is,
                outOfSample: oos,
                halves: r.halves,
                approved: reason === "APROVADA",
                reason,
            });
        }
    return out.sort((a, b) => Number(b.approved) - Number(a.approved) ||
        (b.outOfSample.lower ?? 0) - (a.outOfSample.lower ?? 0));
}
export function specById(id, specs = catalog()) {
    return specs.find((x) => x.id === id);
}
