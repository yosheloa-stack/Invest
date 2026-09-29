import type { Signal } from "./types.js";
import { HORIZONS } from "./types.js";
export function signalBlocked(
  symbol: string,
  now: number,
  cooldownMs: number,
  cooldowns: ReadonlyMap<string, number>,
  active: Iterable<Signal>,
) {
  return (
    HORIZONS.some(
      (h) => now - (cooldowns.get(`${symbol}:${h}`) ?? -Infinity) < cooldownMs,
    ) ||
    [...active].some(
      (s) => s.symbol === symbol && ["PENDING", "FILLED"].includes(s.status),
    )
  );
}
