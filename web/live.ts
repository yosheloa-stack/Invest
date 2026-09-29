import { useSyncExternalStore } from "react";
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
  serverTime = 0;
export function pushTick(msg: { t: number; k: Record<string, number[]> }) {
  serverTime = msg.t;
  for (const [symbol, [t, o, h, l, c, v, buy]] of Object.entries(msg.k)) {
    const old = bars.get(symbol);
    if (old) prev.set(symbol, old.c);
    bars.set(symbol, { t, o, h, l, c, v, buy });
  }
  version++;
  for (const f of listeners) f();
}
export const liveBar = (symbol: string) => bars.get(symbol);
export const lastServerTime = () => serverTime;
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
