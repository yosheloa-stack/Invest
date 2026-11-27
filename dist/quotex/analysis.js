// --- Indicator calculations (self-contained, ported from YOSH) ---
function ema(src, period) {
    const out = new Array(src.length).fill(NaN);
    if (src.length < period)
        return out;
    let sum = 0;
    for (let i = 0; i < period; i++)
        sum += src[i];
    out[period - 1] = sum / period;
    const k = 2 / (period + 1);
    for (let i = period; i < src.length; i++) {
        out[i] = src[i] * k + out[i - 1] * (1 - k);
    }
    return out;
}
function sma(src, period) {
    const out = new Array(src.length).fill(NaN);
    let sum = 0;
    for (let i = 0; i < src.length; i++) {
        sum += src[i];
        if (i >= period)
            sum -= src[i - period];
        if (i >= period - 1)
            out[i] = sum / period;
    }
    return out;
}
function rsi(close, period = 14) {
    const out = new Array(close.length).fill(NaN);
    if (close.length < period + 1)
        return out;
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        const d = close[i] - close[i - 1];
        if (d > 0)
            avgGain += d;
        else
            avgLoss -= d;
    }
    avgGain /= period;
    avgLoss /= period;
    out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (let i = period + 1; i < close.length; i++) {
        const d = close[i] - close[i - 1];
        avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
        avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return out;
}
function macd(close, fast = 12, slow = 26, sig = 9) {
    const emaFast = ema(close, fast);
    const emaSlow = ema(close, slow);
    const m = close.map((_, i) => isNaN(emaFast[i]) || isNaN(emaSlow[i]) ? NaN : emaFast[i] - emaSlow[i]);
    const valid = m.filter((v) => !isNaN(v));
    const s = ema(valid, sig);
    // Align signal back
    const signal = new Array(close.length).fill(NaN);
    const hist = new Array(close.length).fill(NaN);
    let si = 0;
    for (let i = 0; i < close.length; i++) {
        if (!isNaN(m[i])) {
            signal[i] = s[si] ?? NaN;
            hist[i] = isNaN(signal[i]) ? NaN : m[i] - signal[i];
            si++;
        }
    }
    return { macd: m, signal, histogram: hist };
}
function bollinger(close, period = 20, stdDev = 2) {
    const mid = sma(close, period);
    const upper = new Array(close.length).fill(NaN);
    const lower = new Array(close.length).fill(NaN);
    for (let i = period - 1; i < close.length; i++) {
        let sq = 0;
        for (let j = i - period + 1; j <= i; j++)
            sq += (close[j] - mid[i]) ** 2;
        const sd = Math.sqrt(sq / period);
        upper[i] = mid[i] + stdDev * sd;
        lower[i] = mid[i] - stdDev * sd;
    }
    return { upper, middle: mid, lower };
}
function stochastic(high, low, close, kPeriod = 14, dPeriod = 3) {
    const k = new Array(close.length).fill(NaN);
    for (let i = kPeriod - 1; i < close.length; i++) {
        let hh = -Infinity, ll = Infinity;
        for (let j = i - kPeriod + 1; j <= i; j++) {
            hh = Math.max(hh, high[j]);
            ll = Math.min(ll, low[j]);
        }
        k[i] = hh === ll ? 50 : ((close[i] - ll) / (hh - ll)) * 100;
    }
    const d = sma(k.map((v) => (isNaN(v) ? 0 : v)), dPeriod);
    return { k, d };
}
function body(b) {
    return Math.abs(b.c - b.o);
}
function range(b) {
    return b.h - b.l;
}
function isBullish(b) {
    return b.c > b.o;
}
function isBearish(b) {
    return b.c < b.o;
}
function upperWick(b) {
    return b.h - Math.max(b.o, b.c);
}
function lowerWick(b) {
    return Math.min(b.o, b.c) - b.l;
}
function isBullishEngulfing(prev, curr) {
    return isBearish(prev) && isBullish(curr) && curr.o <= prev.c && curr.c >= prev.o;
}
function isBearishEngulfing(prev, curr) {
    return isBullish(prev) && isBearish(curr) && curr.o >= prev.c && curr.c <= prev.o;
}
function isHammer(b) {
    const bd = body(b);
    const rng = range(b);
    if (rng === 0)
        return false;
    return lowerWick(b) >= bd * 2 && upperWick(b) <= bd * 0.3;
}
function isShootingStar(b) {
    const bd = body(b);
    const rng = range(b);
    if (rng === 0)
        return false;
    return upperWick(b) >= bd * 2 && lowerWick(b) <= bd * 0.3;
}
function isDoji(b) {
    const rng = range(b);
    return rng > 0 && body(b) / rng < 0.1;
}
// --- Trend detection ---
function detectTrend(ema9, ema21, ema50, i) {
    if (isNaN(ema9[i]) || isNaN(ema21[i]) || isNaN(ema50[i]))
        return "flat";
    if (ema9[i] > ema21[i] && ema21[i] > ema50[i])
        return "up";
    if (ema9[i] < ema21[i] && ema21[i] < ema50[i])
        return "down";
    return "flat";
}
// --- Support/Resistance ---
function findLevels(candles, lookback = 50) {
    const supports = [];
    const resistances = [];
    const start = Math.max(0, candles.length - lookback);
    for (let i = start + 2; i < candles.length - 2; i++) {
        const lo = candles[i].l;
        if (lo < candles[i - 1].l && lo < candles[i - 2].l && lo < candles[i + 1].l && lo < candles[i + 2].l) {
            supports.push(lo);
        }
        const hi = candles[i].h;
        if (hi > candles[i - 1].h && hi > candles[i - 2].h && hi > candles[i + 1].h && hi > candles[i + 2].h) {
            resistances.push(hi);
        }
    }
    return { supports, resistances };
}
function nearLevel(price, levels, threshold = 0.001) {
    return levels.some((l) => Math.abs(price - l) / price < threshold);
}
export function analyzeCandles(candles, assetName) {
    if (candles.length < 50)
        return { direction: null, confidence: 0, reasons: ["dados insuficientes"] };
    const close = candles.map((c) => c.c);
    const high = candles.map((c) => c.h);
    const low = candles.map((c) => c.l);
    const n = close.length;
    const i = n - 1;
    const prev = i - 1;
    // Calculate indicators
    const ema9 = ema(close, 9);
    const ema21 = ema(close, 21);
    const ema50 = ema(close, 50);
    const rsiValues = rsi(close, 14);
    const macdResult = macd(close, 12, 26, 9);
    const boll = bollinger(close, 20, 2);
    const stoch = stochastic(high, low, close, 14, 3);
    const curRsi = rsiValues[i];
    const curMacd = macdResult.macd[i];
    const curMacdSignal = macdResult.signal[i];
    const curMacdHist = macdResult.histogram[i];
    const prevMacdHist = macdResult.histogram[prev];
    const curStochK = stoch.k[i];
    const trend = detectTrend(ema9, ema21, ema50, i);
    const curBar = candles[i];
    const prevBar = candles[prev];
    const prevBar2 = candles[Math.max(0, i - 2)];
    const { supports, resistances } = findLevels(candles, 80);
    const callReasons = [];
    const putReasons = [];
    // --- Trend alignment ---
    if (trend === "up")
        callReasons.push("tendencia alta (EMA 9>21>50)");
    else if (trend === "down")
        putReasons.push("tendencia baixa (EMA 9<21<50)");
    // --- RSI signals ---
    if (!isNaN(curRsi)) {
        if (curRsi < 30)
            callReasons.push(`RSI sobrevendido (${curRsi.toFixed(1)})`);
        else if (curRsi > 70)
            putReasons.push(`RSI sobrecomprado (${curRsi.toFixed(1)})`);
        // RSI crossing midline
        if (curRsi > 50 && rsiValues[prev] < 50)
            callReasons.push("RSI cruzou 50 pra cima");
        if (curRsi < 50 && rsiValues[prev] > 50)
            putReasons.push("RSI cruzou 50 pra baixo");
    }
    // --- MACD signals ---
    if (!isNaN(curMacdHist) && !isNaN(prevMacdHist)) {
        if (curMacdHist > 0 && prevMacdHist <= 0)
            callReasons.push("MACD cruzamento alta");
        if (curMacdHist < 0 && prevMacdHist >= 0)
            putReasons.push("MACD cruzamento baixa");
        if (curMacdHist > 0 && curMacdHist > prevMacdHist)
            callReasons.push("MACD histograma crescendo");
        if (curMacdHist < 0 && curMacdHist < prevMacdHist)
            putReasons.push("MACD histograma caindo");
    }
    // --- Bollinger Band signals ---
    if (!isNaN(boll.lower[i]) && !isNaN(boll.upper[i])) {
        if (curBar.c <= boll.lower[i])
            callReasons.push("preco na Bollinger inferior");
        if (curBar.c >= boll.upper[i])
            putReasons.push("preco na Bollinger superior");
        // Squeeze (low volatility -> breakout expected)
        const bandwidth = (boll.upper[i] - boll.lower[i]) / boll.middle[i];
        if (bandwidth < 0.02) {
            callReasons.push("Bollinger squeeze (volatilidade baixa)");
            putReasons.push("Bollinger squeeze (volatilidade baixa)");
        }
    }
    // --- Stochastic signals ---
    if (!isNaN(curStochK)) {
        if (curStochK < 20)
            callReasons.push(`Estocastico sobrevendido (${curStochK.toFixed(0)})`);
        if (curStochK > 80)
            putReasons.push(`Estocastico sobrecomprado (${curStochK.toFixed(0)})`);
    }
    // --- Candlestick patterns ---
    if (isBullishEngulfing(prevBar, curBar))
        callReasons.push("engolfo de alta");
    if (isBearishEngulfing(prevBar, curBar))
        putReasons.push("engolfo de baixa");
    if (isHammer(curBar) && trend !== "up")
        callReasons.push("martelo");
    if (isShootingStar(curBar) && trend !== "down")
        putReasons.push("estrela cadente");
    // Three white soldiers / three black crows
    if (isBullish(prevBar2) &&
        isBullish(prevBar) &&
        isBullish(curBar) &&
        prevBar.c > prevBar2.c &&
        curBar.c > prevBar.c)
        callReasons.push("3 soldados brancos");
    if (isBearish(prevBar2) &&
        isBearish(prevBar) &&
        isBearish(curBar) &&
        prevBar.c < prevBar2.c &&
        curBar.c < prevBar.c)
        putReasons.push("3 corvos negros");
    // --- Price vs EMA (pullback) ---
    if (!isNaN(ema21[i]) && trend === "up" && curBar.l <= ema21[i] && curBar.c > ema21[i]) {
        callReasons.push("pullback na EMA21 em tendencia alta");
    }
    if (!isNaN(ema21[i]) && trend === "down" && curBar.h >= ema21[i] && curBar.c < ema21[i]) {
        putReasons.push("pullback na EMA21 em tendencia baixa");
    }
    // --- Support/Resistance filter ---
    const atSupport = nearLevel(curBar.c, supports, 0.0015);
    const atResistance = nearLevel(curBar.c, resistances, 0.0015);
    if (atSupport)
        callReasons.push("proximo a suporte");
    if (atResistance)
        putReasons.push("proximo a resistencia");
    // --- Determine direction ---
    const callScore = callReasons.length;
    const putScore = putReasons.length;
    // Discard if conflicting signals cancel out
    if (callScore > 0 && putScore > 0 && Math.abs(callScore - putScore) <= 1) {
        return { direction: null, confidence: 0, reasons: ["sinais conflitantes"] };
    }
    // Filter: reject trades against strong trend
    if (trend === "up" && putScore > callScore) {
        return { direction: null, confidence: 0, reasons: ["sinal contra tendencia dominante"] };
    }
    if (trend === "down" && callScore > putScore) {
        return { direction: null, confidence: 0, reasons: ["sinal contra tendencia dominante"] };
    }
    // Filter: reject calls at resistance, puts at support (against level)
    if (callScore > putScore && atResistance && !atSupport) {
        return { direction: null, confidence: 0, reasons: ["call rejeitada em resistencia"] };
    }
    if (putScore > callScore && atSupport && !atResistance) {
        return { direction: null, confidence: 0, reasons: ["put rejeitada em suporte"] };
    }
    if (callScore > putScore) {
        return {
            direction: "call",
            confidence: callScore,
            reasons: callReasons,
        };
    }
    if (putScore > callScore) {
        return {
            direction: "put",
            confidence: putScore,
            reasons: putReasons,
        };
    }
    return { direction: null, confidence: 0, reasons: ["sem confluencia"] };
}
