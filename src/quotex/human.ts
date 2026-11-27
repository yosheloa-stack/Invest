// Human-like timing and behavior simulation.
// Even on WebSocket, variable delays between actions make the trading pattern
// indistinguishable from a person who checks the chart, thinks, then acts.

function gaussianRandom(): number {
  // Box-Muller transform
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** Sleep with Gaussian distribution around a mean, clamped to [min, max]. */
export function humanDelay(meanMs: number, stdMs: number, minMs = 500, maxMs?: number): Promise<void> {
  const ms = Math.round(meanMs + gaussianRandom() * stdMs);
  const clamped = Math.max(minMs, Math.min(maxMs ?? meanMs * 3, ms));
  return new Promise((r) => setTimeout(r, clamped));
}

/** Delay before looking at a new asset (1-4 seconds, like switching tabs). */
export function browseDelay(): Promise<void> {
  return humanDelay(2500, 800, 1000, 5000);
}

/** Delay before placing a trade (thinking time, 2-6 seconds). */
export function thinkDelay(): Promise<void> {
  return humanDelay(3500, 1200, 1500, 8000);
}

/** Delay between checking assets in a scan loop (0.5-2 seconds). */
export function scanDelay(): Promise<void> {
  return humanDelay(1200, 400, 500, 3000);
}

/** Delay after a trade result (emotional response time, 3-10 seconds). */
export function resultDelay(): Promise<void> {
  return humanDelay(5000, 2000, 2000, 12000);
}

/** Longer random pause to simulate distraction (10-60 seconds, rare). */
export function distractionPause(): Promise<void> {
  return humanDelay(30000, 15000, 10000, 60000);
}

/** Should the bot take a "distraction" pause this cycle? (~5% chance) */
export function shouldDistract(): boolean {
  return Math.random() < 0.05;
}

/**
 * Jitter a fixed interval so it doesn't fire at exact intervals.
 * Adds ±20% randomness.
 */
export function jitter(baseMs: number): number {
  return Math.round(baseMs * (0.8 + Math.random() * 0.4));
}

/**
 * Simulate a "session" with realistic active hours.
 * Returns true if the current time is within typical trading hours.
 * Brazilian market: ~9h-18h BRT. Forex: varies. Crypto: 24/7.
 */
export function isActiveHour(): boolean {
  const hour = new Date().getUTCHours();
  // Avoid very late night / early morning (UTC 4-8 = BRT 1-5am)
  return hour < 4 || hour >= 8;
}
