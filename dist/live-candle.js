// Use the exchange's forming OHLC as the baseline, including trades before connection.
// Only trades newer than that snapshot extend its price/volume. Never publish an old minute.
export function liveCandle(s) {
    if (!s.connected || !s.trade)
        return null;
    const start = Math.floor(s.trade.t / 60000) * 60000;
    const base = s.forming?.t === start ? s.forming : undefined;
    const trades = s.trades.filter((t) => t.t >= start && (!base || t.t > (s.formingAt ?? 0)));
    if (!base && !trades.length)
        return null;
    const b = base
        ? { ...base }
        : {
            t: start,
            end: start + 59999,
            o: trades[0].p,
            h: trades[0].p,
            l: trades[0].p,
            c: trades[0].p,
            v: 0,
            buy: 0,
            quote: 0,
        };
    for (const t of trades) {
        b.h = Math.max(b.h, t.p);
        b.l = Math.min(b.l, t.p);
        b.c = t.p;
        b.v += t.q;
        b.buy += t.buy ? t.q : 0;
        b.quote += t.p * t.q;
    }
    return b;
}
