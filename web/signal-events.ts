import type { Signal } from "./types";
export type SignalEvent = {
  key: string;
  signal: Signal;
  kind: "entry" | "filled" | "result" | "closed";
};
// Consume full snapshots, including transitions missed between two WebSocket frames.
export class SignalEvents {
  private seen = new Set<string>();
  private initialized = false;
  consume(signals: Signal[], now: number, fresh: boolean): SignalEvent[] {
    if (!fresh) return [];
    const events: SignalEvent[] = [];
    for (const signal of new Map(signals.map((s) => [s.id, s])).values()) {
      const kind =
        signal.status === "PENDING"
          ? "entry"
          : signal.status === "FILLED"
            ? "filled"
            : signal.status === "SETTLED"
              ? "result"
              : ["NO_DATA", "INVALIDATED", "EXPIRED"].includes(signal.status)
                ? "closed"
                : null;
      if (!kind) continue;
      const key = `${signal.id}:${kind}`;
      if (this.seen.has(key)) continue;
      const entrySeen = this.seen.has(`${signal.id}:entry`);
      this.seen.add(key);
      const timely =
        kind === "entry"
          ? signal.expires > now && now - signal.t < 30000
          : kind === "filled"
            ? !entrySeen && now - (signal.entryAt ?? signal.t) < 30000
            : kind === "result"
              ? this.initialized && now - (signal.exitAt ?? 0) < 120000
              : this.initialized && entrySeen;
      if (timely) events.push({ key, signal, kind });
    }
    this.initialized = true;
    if (this.seen.size > 2000) this.seen = new Set([...this.seen].slice(-1000));
    return events;
  }
}
export const resultLabel = (s: Signal) =>
  s.result === "WIN"
    ? "GREEN"
    : s.result === "LOSS"
      ? "RED"
      : s.result === "NEUTRO"
        ? "NEUTRO"
        : s.status === "NO_DATA"
          ? "SEM COTAÇÃO"
          : s.status === "EXPIRED"
            ? "EXPIRADO"
            : "INVALIDADO";
export const evidenceLabel = (s: Signal) =>
  s.modelId.startsWith("estrategia:")
    ? "Acerto no backtest"
    : "Estimativa do modelo";
