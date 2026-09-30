import { useEffect, useState, useSyncExternalStore } from "react";
// Live forming-candle store fed by the 4x-per-second "tick" frames of the dashboard socket.
// Kept outside React so the chart can redraw without re-rendering the whole page.
export type Bar = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  buy: number;
};
const bars = new Map<string, Bar>(),
  prev = new Map<string, number>(),
  listeners = new Set<() => void>();
let version = 0,
  serverTime = 0,
  receivedAt = 0;
export function pushTick(msg: { t: number; k: Record<string, number[]> }) {
  if (!Number.isFinite(msg.t) || msg.t < serverTime) return;
  serverTime = msg.t;
  receivedAt = performance.now();
  for (const [symbol, [t, o, h, l, c, v, buy]] of Object.entries(msg.k)) {
    if (![t, o, h, l, c, v, buy].every(Number.isFinite) || c <= 0 || h < l)
      continue;
    const old = bars.get(symbol);
    if (old && t < old.t) continue;
    if (old) prev.set(symbol, old.c);
    bars.set(symbol, { t, o, h, l, c, v, buy });
  }
  version++;
  for (const f of listeners) f();
}
export const liveBar = (symbol: string) => bars.get(symbol);
export const lastServerTime = () =>
  serverTime ? serverTime + performance.now() - receivedAt : 0;
// Direction of the latest change for the price flash: 1 up, -1 down, 0 flat.
export const lastMove = (symbol: string) => {
  const b = bars.get(symbol),
    p = prev.get(symbol);
  return !b || p == null ? 0 : Math.sign(b.c - p);
};
export function subscribe(f: () => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}
export const useTicks = () =>
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
// Same as useTicks but re-renders at most once per `ms`: for long lists (ticker tape,
// watchlist) where redrawing 57 rows on every price frame slowed phones down.
export function useSlowTicks(ms = 1000) {
  const [, setN] = useState(0);
  useEffect(() => {
    let last = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    const off = subscribe(() => {
      if (timer) return;
      const wait = Math.max(0, last + ms - Date.now());
      timer = setTimeout(() => {
        timer = undefined;
        last = Date.now();
        setN((n) => n + 1);
      }, wait);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [ms]);
}
