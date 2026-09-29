import { wilson } from "./strategies.js";
// Losses never increase claimed confidence. Only completed paper outcomes from
// the same instrument, horizon and versioned strategy may temporarily block it.
export function paperFeedback(candidate, history, now, payout) {
    const rows = [...new Map(history.map((s) => [s.id, s])).values()]
        .filter((s) => s.symbol === candidate.symbol &&
        s.horizon === candidate.horizon &&
        s.modelId === candidate.modelId &&
        s.status === "SETTLED" &&
        (s.result === "WIN" || s.result === "LOSS") &&
        s.exitAt != null &&
        s.exitAt <= now &&
        now - s.exitAt <= 7 * 86400000)
        .sort((a, b) => b.exitAt - a.exitAt)
        .slice(0, 50);
    const wins = rows.filter((s) => s.result === "WIN").length, n = rows.length;
    const upper = n ? 1 - wilson(n - wins, n, 1.96) : null;
    const until = (rows[0]?.exitAt ?? 0) + 3600000;
    const paused = n >= 20 && upper < 1 / (1 + payout) && now < until;
    return {
        count: n,
        wins,
        losses: n - wins,
        winRate: n ? wins / n : null,
        upper,
        paused,
        until: paused ? until : null,
    };
}
export function applyPaperFeedback(d, history, now, payout) {
    if (!d.signal)
        return d;
    const p = paperFeedback(d.signal, history, now, payout);
    if (!p.paused)
        return d;
    return {
        ...d,
        state: "SEM ENTRADA",
        signal: undefined,
        reason: `PAUSA PELO HISTÓRICO PAPER: ${p.wins}/${p.count} acertos; reavaliar após ${new Date(p.until).toISOString()}`,
        contrary: [...d.contrary, "DESEMPENHO PAPER RECENTE ABAIXO DO EQUILÍBRIO"],
    };
}
