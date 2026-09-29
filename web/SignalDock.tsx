import { useEffect, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  BellOff,
  Check,
  X,
} from "lucide-react";
import { countdown, pair, pct, price } from "./format";
import type { LabBrief, Signal } from "./types";
import { CoinIcon } from "./Icons";
function beep(up: boolean) {
  try {
    const ctx = new AudioContext(),
      o = ctx.createOscillator(),
      g = ctx.createGain();
    o.frequency.value = up ? 880 : 520;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.55);
  } catch {
    /* audio blocked until the user interacts with the page */
  }
}
// The one place that tells the trader what to do right now: enter, wait for expiry, or see the result.
export default function SignalDock({
  signals,
  now,
  prices,
  lab,
  onOpen,
}: {
  signals: Signal[];
  now: number;
  prices: Record<string, number | null>;
  lab?: LabBrief;
  onOpen: (symbol: string) => void;
}) {
  const [alerts, setAlerts] = useState(() => {
    try {
      return localStorage.getItem("yosh-alerts") === "on";
    } catch {
      return false;
    }
  });
  const seen = useRef<Set<string> | null>(null);
  const pending = signals.find(
      (s) => s.status === "PENDING" && s.expires > now,
    ),
    running = signals.find((s) => s.status === "FILLED"),
    done = signals.find(
      (s) => s.status === "SETTLED" && s.exitAt && now - s.exitAt < 90000,
    ),
    current = pending || running || done;
  useEffect(() => {
    const ids = new Set(
      signals.filter((s) => s.status === "PENDING").map((s) => s.id),
    );
    if (seen.current === null) {
      seen.current = ids;
      return;
    }
    for (const s of signals)
      if (s.status === "PENDING" && !seen.current.has(s.id)) {
        seen.current.add(s.id);
        if (!alerts) continue;
        beep(s.direction === "COMPRA");
        try {
          if (Notification.permission === "granted")
            new Notification(
              `${s.direction} ${pair(s.symbol)} · ${s.horizon} min`,
              {
                body: `Entre agora. Acerto medido no teste: ${pct(s.probability)}.`,
                tag: s.id,
              },
            );
        } catch {
          /* notifications unsupported */
        }
      }
  }, [signals, alerts]);
  const toggle = async () => {
    const next = !alerts;
    if (
      next &&
      "Notification" in window &&
      Notification.permission === "default"
    )
      await Notification.requestPermission().catch(() => undefined);
    setAlerts(next);
    try {
      localStorage.setItem("yosh-alerts", next ? "on" : "off");
    } catch {
      /* private mode */
    }
    if (next) beep(true);
  };
  const bell = (
    <button className="dock-bell" onClick={toggle} aria-pressed={alerts}>
      {alerts ? <Bell size={18} /> : <BellOff size={18} />}
      <span>{alerts ? "Avisos ligados" : "Ligar avisos"}</span>
    </button>
  );
  if (!current)
    return (
      <div className="dock idle" role="status">
        <div className="dock-main">
          <span className="dock-pulse" />
          <div>
            <strong>Aguardando entrada</strong>
            <p>
              {lab?.approved
                ? `${lab.approved} estratégia(s) aprovada(s) vigiando o mercado. O aviso aparece aqui na hora.`
                : "Nenhuma estratégia passou no teste agora. Sem entrada é melhor do que entrada ruim."}
            </p>
          </div>
        </div>
        {bell}
      </div>
    );
  const buy = current.direction === "COMPRA",
    Icon = buy ? ArrowUpRight : ArrowDownRight,
    live = prices[current.symbol] ?? null;
  if (current === pending)
    return (
      <div className={`dock enter ${buy ? "buy" : "sell"}`} role="alert">
        <button className="dock-main" onClick={() => onOpen(current.symbol)}>
          <Icon size={34} strokeWidth={2.6} />
          <div>
            <strong>
              <CoinIcon symbol={current.symbol} size={18} />{" "}
              {buy ? "Compra" : "Venda"} {pair(current.symbol)} · expiração{" "}
              {current.horizon} min
            </strong>
            <p>
              Entre agora, até {price(current.entryLow)} –{" "}
              {price(current.entryHigh)}. Acerto medido no teste:{" "}
              {pct(current.probability)}.
            </p>
          </div>
          <span className="dock-timer">{countdown(current.expires - now)}</span>
        </button>
        {bell}
      </div>
    );
  if (current === running) {
    const ahead =
      live != null && current.entry != null
        ? (live - current.entry) * (buy ? 1 : -1) > 0
        : null;
    return (
      <div className={`dock running ${buy ? "buy" : "sell"}`} role="status">
        <button className="dock-main" onClick={() => onOpen(current.symbol)}>
          <Icon size={28} />
          <div>
            <strong>
              <CoinIcon symbol={current.symbol} size={18} />{" "}
              {buy ? "Compra" : "Venda"} {pair(current.symbol)} em andamento
            </strong>
            <p>
              Entrada {price(current.entry)} · agora {price(live)} ·{" "}
              {ahead == null ? "—" : ahead ? "ganhando" : "perdendo"}
            </p>
          </div>
          <span className="dock-timer">
            {countdown((current.due ?? now) - now)}
          </span>
        </button>
        {bell}
      </div>
    );
  }
  const won = current.result === "WIN";
  return (
    <div className={`dock result ${won ? "won" : "lost"}`} role="status">
      <button className="dock-main" onClick={() => onOpen(current.symbol)}>
        {won ? <Check size={30} /> : <X size={30} />}
        <div>
          <strong>
            {won ? "Ganhou" : current.result === "LOSS" ? "Perdeu" : "Empatou"}{" "}
            · {pair(current.symbol)} {current.horizon} min
          </strong>
          <p>
            Entrada {price(current.entry)} → saída {price(current.exit)}.
            Resultado registrado no histórico.
          </p>
        </div>
      </button>
      {bell}
    </div>
  );
}
