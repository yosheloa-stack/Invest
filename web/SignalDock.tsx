import { useEffect, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  BellOff,
  Check,
  X,
} from "lucide-react";
import { clock, countdown, pair, pct, price } from "./format";
import type { LabBrief, Signal } from "./types";
import { CoinIcon } from "./Icons";
import { SignalEvents, resultLabel, evidenceLabel } from "./signal-events";
let audio: AudioContext | undefined;
export async function unlockAudio() {
  try {
    audio ??= new AudioContext();
    await audio.resume();
  } catch {
    /* unsupported */
  }
}
export function beep(up: boolean) {
  if (!audio || audio.state !== "running") return;
  const o = audio.createOscillator(),
    g = audio.createGain();
  o.frequency.value = up ? 880 : 520;
  g.gain.setValueAtTime(0.0001, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.15, audio.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.4);
  o.connect(g).connect(audio.destination);
  o.onended = () => {
    o.disconnect();
    g.disconnect();
  };
  o.start();
  o.stop(audio.currentTime + 0.45);
}
// The one place that tells the trader what to do right now: enter, wait for expiry, or see the result.
export default function SignalDock({
  signals,
  fresh,
  now,
  prices,
  lab,
  onOpen,
}: {
  signals: Signal[];
  fresh: boolean;
  now: number;
  prices: Record<string, number | null>;
  lab?: LabBrief;
  onOpen: (symbol: string) => void;
}) {
  // Sound must be unlocked by a user gesture on each page load.
  const [alerts, setAlerts] = useState(false);
  const [permission, setPermission] = useState("Avisos nesta página");
  const events = useRef(new SignalEvents());
  const pending = fresh
      ? signals.find((s) => s.status === "PENDING" && s.expires > now)
      : undefined,
    running = fresh ? signals.find((s) => s.status === "FILLED") : undefined,
    done = signals.find(
      (s) => s.status === "SETTLED" && s.exitAt && now - s.exitAt < 90000,
    ),
    current = pending || running || done;
  useEffect(() => {
    const notices = events.current.consume(signals, now, fresh);
    if (!alerts || !notices.length) return;
    beep(notices.some((e) => e.kind === "entry" || e.signal.result === "WIN"));
    for (const { signal: s, kind, key } of notices) {
      const title =
        kind === "entry"
          ? `${s.direction} ${pair(s.symbol)} · ${s.horizon} min`
          : kind === "filled"
            ? `Entrada paper registrada · ${pair(s.symbol)}`
            : `${resultLabel(s)} · ${pair(s.symbol)} · ${s.horizon} min`;
      const body =
        kind === "entry"
          ? `Válido por ${countdown(s.expires - now)}. ${evidenceLabel(s)}: ${pct(s.probability)}.`
          : kind === "filled"
            ? `Entrada ${price(s.entry)}. Saída às ${clock(s.due ?? now)} (${countdown((s.due ?? now) - now)}).`
            : kind === "result"
              ? `Paper: ${price(s.entry)} → ${price(s.exit)}. Resultado salvo no histórico.`
              : s.reason || "Entrada encerrada sem resultado válido.";
      try {
        if ("Notification" in window && Notification.permission === "granted")
          new Notification(title, { body, tag: key });
      } catch {
        /* in-page activity remains available */
      }
    }
  }, [signals, alerts, fresh, now]);
  const toggle = async () => {
    if (alerts) {
      setAlerts(false);
      return;
    }
    // Unlock before awaiting notification permission, while the gesture is active.
    const unlocking = unlockAudio();
    let message = "Som ativo · mantenha esta página aberta";
    if ("Notification" in window) {
      const p =
        Notification.permission === "default"
          ? await Notification.requestPermission().catch(() => "denied")
          : Notification.permission;
      message =
        p === "granted"
          ? "Som e avisos do navegador ativos"
          : "Som ativo · notificações bloqueadas no navegador";
    }
    await unlocking;
    if (!audio || audio.state !== "running")
      message = "Som indisponível · acompanhe os avisos na página";
    setPermission(message);
    setAlerts(true);
    beep(true);
  };
  const bell = (
    <button
      className="dock-bell"
      onClick={toggle}
      aria-pressed={alerts}
      title={permission}
      aria-label={alerts ? permission : "Ligar avisos"}
    >
      {alerts ? <Bell size={15} /> : <BellOff size={15} />}
      <span>{alerts ? "Avisos ligados" : "Ligar avisos"}</span>
    </button>
  );
  if (!fresh || !current)
    return (
      <div className="dock idle" role="status">
        <div className="dock-main">
          <span className="dock-pulse" />
          <div>
            <strong>
              {fresh
                ? "Aguardando entrada"
                : "Feed interrompido · entradas pausadas"}
            </strong>
            <p>
              {!fresh
                ? "Aguarde a reconexão. Os resultados ficam no histórico."
                : lab?.approved
                  ? `${lab.approved} estratégia(s) aprovada(s) vigiando o mercado`
                  : "Nenhuma estratégia aprovada agora · sem entrada é melhor que entrada ruim"}
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
              Faixa de entrada: {price(current.entryLow)} –{" "}
              {price(current.entryHigh)}. {evidenceLabel(current)}:{" "}
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
              Entrada {price(current.entry)} às {clock(current.entryAt!)} ·
              saída às {clock(current.due!)} · agora {price(live)} ·{" "}
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
            {resultLabel(current)} · paper · {pair(current.symbol)}{" "}
            {current.horizon} min
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
