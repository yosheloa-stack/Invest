import { HORIZONS } from "./types.js";
export function signalBlocked(symbol, now, cooldownMs, cooldowns, active) {
    return (HORIZONS.some((h) => now - (cooldowns.get(`${symbol}:${h}`) ?? -Infinity) < cooldownMs) ||
        [...active].some((s) => s.symbol === symbol && ["PENDING", "FILLED"].includes(s.status)));
}
