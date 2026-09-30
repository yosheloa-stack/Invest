import { useEffect, useRef, useState } from "react";
import {
  ArrowBigDown,
  ArrowBigUp,
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  Volume2,
  VolumeX,
  X,
  Pause,
  Play,
  Sparkles,
} from "lucide-react";
import { CoinIcon } from "./Icons";
import { beep, unlockAudio } from "./SignalDock";
import { STUDIES, studiesFor, type Study } from "./studies";
import { liveBar, useTicks } from "./live";
import {
  api,
  clock,
  countdown,
  pair,
  pct,
  price,
  sentence,
  ticker,
} from "./format";
import type {
  MarketRead,
  RobotBrief,
  RobotSummary,
  RobotTrade,
  User,
} from "./types";
const STUDY_NAME = Object.fromEntries(
  STUDIES.map((x) => [x.id, x.label]),
) as Record<Study, string>;
const money = (n: number | null | undefined, sign = false) =>
  n == null
    ? "—"
    : `${sign && n > 0 ? "+" : ""}${n.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
const dirText = (d: string) => (d === "COMPRA" ? "Compra" : "Venda");
function useRobot() {
  const [data, setData] = useState<RobotSummary | null>(null),
    [error, setError] = useState<string | null>(null);
  const load = () =>
    api<RobotSummary>("/api/robot")
      .then((x) => {
        setData(x);
        setError(null);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  return { data, error, reload: load };
}
function Dir({ d }: { d: "COMPRA" | "VENDA" }) {
  return (
    <span className={`rb-dir ${d === "COMPRA" ? "buy" : "sell"}`}>
      {d === "COMPRA" ? (
        <ArrowUpRight size={14} />
      ) : (
        <ArrowDownRight size={14} />
      )}
      {dirText(d)}
    </span>
  );
}
function OpenTrade({ t, now }: { t: RobotTrade; now: number }) {
  useTicks();
  const c = liveBar(t.symbol)?.c ?? null,
    move = c == null ? 0 : (c - t.entry) * (t.direction === "COMPRA" ? 1 : -1),
    left = t.due - now,
    total = t.horizon * 60000,
    done = Math.min(1, Math.max(0, 1 - left / total));
  return (
    <div className={`rb-open ${move > 0 ? "win" : move < 0 ? "lose" : ""}`}>
      <div className="rb-open-head">
        <CoinIcon symbol={t.symbol} size={20} />
        <b>{ticker(t.symbol)}</b>
        <Dir d={t.direction} />
        <span className="muted">{t.horizon} min</span>
        <strong className="rb-count">{countdown(left)}</strong>
      </div>
      <div className="rb-bar">
        <i style={{ width: `${done * 100}%` }} />
      </div>
      <div className="rb-open-grid">
        <span>
          Entrada <b>{price(t.entry)}</b>
        </span>
        <span>
          Agora <b>{price(c)}</b>
        </span>
        <span className={move > 0 ? "up" : move < 0 ? "down" : "muted"}>
          {move > 0 ? "Ganhando" : move < 0 ? "Perdendo" : "Empatado"}
        </span>
      </div>
      <p className="rb-why">
        {t.strategy}
        {t.ai ? ` · IA ${t.ai.confidence}%: ${t.ai.reason}` : ""}
      </p>
    </div>
  );
}
const EXPIRIES = [1, 5, 10, 15];
const LEVELS: { id: RobotBrief["level"]; label: string; text: string }[] = [
  {
    id: "alta",
    label: "Alta",
    text: "Só entra com gatilho que acertou 3 pontos acima do mínimo que dá lucro. Poucas entradas.",
  },
  {
    id: "media",
    label: "Média",
    text: "Entra com gatilho que acertou acima do mínimo que dá lucro (52,6% com payout 90%), sempre a favor da tendência. Gatilho que perder no robô é pausado sozinho.",
  },
  {
    id: "baixa",
    label: "Baixa",
    text: "Entra com qualquer gatilho a favor da tendência que não perde no histórico (50%+). Muitas entradas, para estudar.",
  },
];
const SOUND_KEY = "yosh-robot-sound";
function soundOn() {
  try {
    return localStorage.getItem(SOUND_KEY) !== "0";
  } catch {
    return true;
  }
}
// Indicators behind the robot's current reading on a pair; the chart switches them on.
export function robotStudies(data: RobotRead | null): Study[] {
  if (!data?.read) return [];
  const open = data.trades.find((t) => t.status === "ABERTA"),
    id = open?.strategyId ?? data.read.pick?.id;
  return [...new Set<Study>(["sr", "ema", ...studiesFor(id)])];
}
// The robot's controls and record, in the chart screen's right panel.
export function RobotSide({
  robot,
  user,
  now,
  onOpen,
}: {
  robot: RobotBrief | null | undefined;
  user: User;
  now: number;
  onOpen: (s: string) => void;
}) {
  const { data, error, reload } = useRobot(),
    brief: RobotBrief | null | undefined = robot ?? data,
    s = brief?.stats,
    be = data?.breakEven ?? 1 / 1.9,
    admin = user.role === "admin",
    [sound, setSound] = useState(soundOn),
    [saving, setSaving] = useState(false);
  const toggle = async () => {
    if (!brief) return;
    await api("/api/robot/toggle", {
      method: "POST",
      body: JSON.stringify({ enabled: !brief.enabled }),
    }).catch(() => undefined);
    void reload();
  };
  const horizons = brief?.horizons ?? EXPIRIES;
  const setExpiry = async (h: number) => {
    const next = horizons.includes(h)
      ? horizons.filter((x) => x !== h)
      : [...horizons, h].sort((a, b) => a - b);
    if (!next.length) return;
    setSaving(true);
    await api("/api/robot/settings", {
      method: "POST",
      body: JSON.stringify({ horizons: next }),
    }).catch(() => undefined);
    await reload();
    setSaving(false);
  };
  const level = brief?.level ?? "media";
  const setLevel = async (l: RobotBrief["level"]) => {
    setSaving(true);
    await api("/api/robot/settings", {
      method: "POST",
      body: JSON.stringify({ level: l }),
    }).catch(() => undefined);
    await reload();
    setSaving(false);
  };
  const flipSound = async () => {
    const on = !sound;
    setSound(on);
    try {
      localStorage.setItem(SOUND_KEY, on ? "1" : "0");
    } catch {
      /* private mode */
    }
    if (!on) return;
    await unlockAudio();
    beep(true);
    if ("Notification" in window && Notification.permission === "default")
      await Notification.requestPermission().catch(() => undefined);
  };
  const history = (data?.trades || [])
    .filter((t) => t.status !== "ABERTA")
    .slice(0, 30);
  return (
    <div className="rb-side">
      <div className="rb-side-head">
        <div className={`rb-avatar small ${brief?.enabled ? "on" : ""}`}>
          <Bot size={18} strokeWidth={1.7} />
        </div>
        <div>
          <b>Robô IA</b>
          <small className="muted">
            {brief
              ? sentence(brief.status)
              : error
                ? error
                : "Carregando o robô…"}
          </small>
        </div>
        {admin && brief && (
          <button className="rb-toggle" onClick={toggle}>
            {brief.enabled ? <Pause size={14} /> : <Play size={14} />}
            {brief.enabled ? "Pausar" : "Ligar"}
          </button>
        )}
      </div>
      <div className="tags">
        <span>Simulação · não envia ordens</span>
        {data &&
          (data.ai.enabled ? (
            <span className="rb-ai on">
              Claude ligado · {data.ai.usedLastHour}/{data.ai.maxPerHour} na
              hora
            </span>
          ) : (
            <span className="rb-ai">Claude desligado · só regras</span>
          ))}
      </div>
      <div className="rb-setting">
        <span>Expirações que o robô usa</span>
        <div className="rb-exp" role="group" aria-label="Expirações">
          {EXPIRIES.map((h) => (
            <button
              key={h}
              className={horizons.includes(h) ? "on" : ""}
              aria-pressed={horizons.includes(h)}
              disabled={!admin || saving}
              onClick={() => setExpiry(h)}
            >
              M{h}
            </button>
          ))}
        </div>
        <small className="muted">
          Vale para qualquer tempo de gráfico: você pode olhar o M1 e entrar com
          expiração de 5 min.
        </small>
      </div>
      <div className="rb-setting">
        <span>Exigência para entrar</span>
        <div className="rb-exp" role="group" aria-label="Exigência">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              className={level === l.id ? "on" : ""}
              aria-pressed={level === l.id}
              disabled={!admin || saving}
              onClick={() => setLevel(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
        <small className="muted">
          {LEVELS.find((l) => l.id === level)?.text}
        </small>
      </div>
      <button className={`rb-sound ${sound ? "on" : ""}`} onClick={flipSound}>
        {sound ? <Volume2 size={15} /> : <VolumeX size={15} />}
        {sound ? "Som de compra e venda ligado" : "Som desligado"}
      </button>
      <div className="rb-mini-stats">
        <div>
          <span>Banca</span>
          <b className={(s?.profit ?? 0) >= 0 ? "up" : "down"}>
            {money(s?.balance)}
          </b>
        </div>
        <div>
          <span>Acerto</span>
          <b
            className={s?.winRate == null ? "" : s.winRate > be ? "up" : "down"}
          >
            {pct(s?.winRate)}
          </b>
        </div>
        <div>
          <span>Ganhos / perdas</span>
          <b>{s ? `${s.wins} / ${s.losses}` : "—"}</b>
        </div>
        <div>
          <span>Hoje</span>
          <b className={(s?.todayProfit ?? 0) >= 0 ? "up" : "down"}>
            {money(s?.todayProfit, true)}
          </b>
        </div>
      </div>
      <p className="muted rb-note">
        Precisa acertar mais de {pct(be)} para dar lucro com payout{" "}
        {pct(data?.payout ?? 0.9, 0)}.
      </p>
      <h3 className="rb-side-title">Operações abertas</h3>
      {brief?.open.length ? (
        brief.open.map((t) => (
          <button
            key={t.id}
            className="rb-open-btn"
            onClick={() => onOpen(t.symbol)}
          >
            <OpenTrade t={t} now={now} />
          </button>
        ))
      ) : (
        <p className="muted">
          Nenhuma aberta. O robô entra sozinho quando um gatilho com bom
          histórico dispara.
        </p>
      )}
      <h3 className="rb-side-title">Histórico</h3>
      <ul className="rb-list">
        {history.map((t) => (
          <li key={t.id} onClick={() => onOpen(t.symbol)}>
            <CoinIcon symbol={t.symbol} size={20} />
            <div>
              <p>
                <b>{ticker(t.symbol)}</b> <Dir d={t.direction} />{" "}
                <span className="muted">M{t.horizon}</span>
              </p>
              <small className="muted">
                {clock(t.openedAt)} · {price(t.entry)} → {price(t.exit)}
              </small>
              <small className="muted">{t.note ?? t.strategy}</small>
            </div>
            {t.status === "CANCELADA" ? (
              <span className="muted">Cancelada</span>
            ) : (
              <b
                className={
                  t.result === "WIN"
                    ? "up"
                    : t.result === "LOSS"
                      ? "down"
                      : "muted"
                }
              >
                {money(t.profit, true)}
              </b>
            )}
          </li>
        ))}
      </ul>
      {!history.length && (
        <p className="muted">As operações aparecem aqui quando vencerem.</p>
      )}
    </div>
  );
}
type Alert = { t: RobotTrade; kind: "entry" | "result"; at: number };
// Big buy/sell warning with sound whenever the robot enters, on any screen.
export function RobotAlerts({
  robot,
  now,
  onOpen,
}: {
  robot: RobotBrief | null | undefined;
  now: number;
  onOpen: (s: string) => void;
}) {
  const seen = useRef<Set<string> | null>(null),
    [alerts, setAlerts] = useState<Alert[]>([]);
  useEffect(() => {
    // Browsers only allow sound after a tap; unlock it on the first one.
    const on = () => void (soundOn() && unlockAudio());
    window.addEventListener("pointerdown", on, { once: true });
    return () => window.removeEventListener("pointerdown", on);
  }, []);
  useEffect(() => {
    if (!robot) return;
    const keys = [
      ...robot.open.map((t) => ({ t, k: `o${t.id}`, kind: "entry" as const })),
      ...robot.last
        .filter((t) => t.status === "FECHADA")
        .map((t) => ({ t, k: `c${t.id}`, kind: "result" as const })),
    ];
    // Nothing that already existed when the page opened is announced.
    if (!seen.current) {
      seen.current = new Set(keys.map((x) => x.k));
      return;
    }
    const fresh = keys.filter((x) => !seen.current!.has(x.k));
    if (!fresh.length) return;
    fresh.forEach((x) => seen.current!.add(x.k));
    const at = Date.now();
    setAlerts((a) =>
      [...fresh.map((x) => ({ t: x.t, kind: x.kind, at })), ...a].slice(0, 3),
    );
    for (const x of fresh) {
      if (x.kind !== "entry") continue;
      const up = x.t.direction === "COMPRA";
      if (soundOn()) {
        beep(up);
        setTimeout(() => beep(up), 220);
      }
      if ("Notification" in window && Notification.permission === "granted")
        try {
          new Notification(
            `Robô: ${up ? "COMPRA" : "VENDA"} ${ticker(x.t.symbol)} · M${x.t.horizon}`,
            {
              body: `Entrada em ${price(x.t.entry)}, expiração de ${x.t.horizon} min.`,
              tag: x.t.id,
            },
          );
        } catch {
          /* mobile browsers without Notification constructor */
        }
    }
  }, [robot]);
  // The warning stays 30 seconds (the trade itself stays on the chart); results 12 seconds.
  const shown = alerts.filter((a) =>
    a.kind === "entry"
      ? now < a.t.due && Date.now() - a.at < 30000
      : Date.now() - a.at < 12000,
  );
  if (!shown.length) return null;
  return (
    <div className="rb-alerts" role="alert">
      {shown.map((a) => {
        const up = a.t.direction === "COMPRA",
          close = () => setAlerts((x) => x.filter((y) => y !== a));
        if (a.kind === "result")
          return (
            <div
              key={`r${a.t.id}`}
              className={`rb-alert result ${a.t.result === "WIN" ? "win" : "lose"}`}
            >
              <CoinIcon symbol={a.t.symbol} size={22} />
              <b>
                {a.t.result === "WIN"
                  ? "Robô ganhou"
                  : a.t.result === "LOSS"
                    ? "Robô perdeu"
                    : "Empate"}{" "}
                {ticker(a.t.symbol)} · M{a.t.horizon}
              </b>
              <span>{money(a.t.profit, true)}</span>
              <button className="icon" aria-label="Fechar" onClick={close}>
                <X size={16} />
              </button>
            </div>
          );
        return (
          <div key={`e${a.t.id}`} className={`rb-alert ${up ? "buy" : "sell"}`}>
            <button
              className="rb-alert-main"
              onClick={() => onOpen(a.t.symbol)}
            >
              {up ? (
                <ArrowBigUp size={34} fill="currentColor" />
              ) : (
                <ArrowBigDown size={34} fill="currentColor" />
              )}
              <span>
                <strong>
                  {up ? "COMPRA" : "VENDA"} {ticker(a.t.symbol)} · M
                  {a.t.horizon}
                </strong>
                <small>
                  Robô entrou em {price(a.t.entry)} · {a.t.strategy}
                </small>
              </span>
              <em className="rb-count">{countdown(a.t.due - now)}</em>
            </button>
            <button className="icon" aria-label="Fechar" onClick={close}>
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
export type RobotRead = {
  enabled: boolean;
  ai: boolean;
  labReady: boolean;
  labStatus: string;
  horizons: number[];
  level?: RobotBrief["level"];
  read: MarketRead | null;
  trades: RobotTrade[];
};
// Live reading of the chart's asset; refreshes on every pair change and every 15s.
export function useRobotRead(symbol: string) {
  const [data, setData] = useState<RobotRead | null>(null);
  useEffect(() => {
    let stop = false;
    setData(null);
    const load = () =>
      api<RobotRead>(`/api/robot/read/${symbol}`)
        .then((x) => !stop && setData(x))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 15000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [symbol]);
  return data;
}
// The robot working on the chart screen: what it sees on this pair, its verdict and its trade.
export function RobotLive({
  symbol,
  data,
  now,
}: {
  symbol: string;
  data: RobotRead | null;
  now: number;
}) {
  useTicks();
  const [ai, setAi] = useState<{ symbol: string; text: string } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [more, setMore] = useState(false);
  useEffect(() => {
    setAi(null);
    setError(null);
  }, [symbol]);
  const r = data?.read,
    open = data?.trades.find((t) => t.status === "ABERTA"),
    done = data?.trades.filter((t) => t.status === "FECHADA") ?? [],
    wins = done.filter((t) => t.result === "WIN").length,
    losses = done.filter((t) => t.result === "LOSS").length;
  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const x = await api<{ text: string | null; aiError: string | null }>(
        "/api/robot/analyze",
        { method: "POST", body: JSON.stringify({ symbol }) },
      );
      if (x.text) setAi({ symbol, text: x.text });
      else setError(x.aiError || "IA sem resposta agora");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const c = liveBar(symbol)?.c ?? null,
    move =
      open && c != null
        ? (c - open.entry) * (open.direction === "COMPRA" ? 1 : -1)
        : 0;
  const lines = r?.lines.slice(0, -1) ?? [];
  const studies = robotStudies(data),
    uses = [
      ...studies.map((x) => STUDY_NAME[x]),
      ...(r?.rsi != null && !studies.includes("rsi")
        ? [`RSI 14 em ${r.rsi.toFixed(0)}`]
        : []),
      ...(open
        ? [`Gatilho ${open.strategy}`]
        : r?.pick
          ? [`Gatilho ${r.pick.label}`]
          : []),
    ];
  return (
    <section className="rb-live" aria-live="polite">
      <header>
        <span className={`rb-dot ${data?.enabled ? "on" : ""}`} />
        <b>Robô IA</b>
        <span className="muted">
          {!data
            ? "carregando…"
            : !data.enabled
              ? "pausado"
              : `analisando ${pair(symbol)} a cada candle`}
        </span>
        {done.length > 0 && (
          <span className="rb-live-score">
            neste par {wins}/{wins + losses}
          </span>
        )}
      </header>
      {open ? (
        <div
          className={`rb-live-trade ${move > 0 ? "win" : move < 0 ? "lose" : ""}`}
        >
          <Dir d={open.direction} />
          <span>
            Entrou em <b>{price(open.entry)}</b> · agora <b>{price(c)}</b>
          </span>
          <b className={move > 0 ? "up" : move < 0 ? "down" : "muted"}>
            {move > 0 ? "Ganhando" : move < 0 ? "Perdendo" : "Empatado"}
          </b>
          <strong className="rb-count">{countdown(open.due - now)}</strong>
        </div>
      ) : r ? (
        <div className="rb-live-verdict">
          {r.pick && data?.labReady ? (
            <>
              <Dir d={r.pick.direction} />
              <b>Expiração {r.pick.horizon} min</b>
              <span className="muted">força {pct(r.pick.score)}</span>
            </>
          ) : (
            <b>Esperar</b>
          )}
          <span className={`rb-trend ${r.trend.toLowerCase()}`}>
            Tendência {r.trend.toLowerCase()}
          </span>
        </div>
      ) : null}
      {r ? (
        <>
          <p className="rb-live-why">
            {open
              ? `Entrou pelo gatilho ${open.strategy}${open.ai ? ` · IA ${open.ai.confidence}%: ${open.ai.reason}` : ""}.`
              : data?.labReady
                ? r.why
                : `Lendo o gráfico; entradas liberadas quando o backtest terminar (${sentence(data?.labStatus)}).`}
          </p>
          <div className="rb-uses">
            <span className="muted">O robô está usando:</span>
            {uses.map((u) => (
              <span key={u}>{u}</span>
            ))}
          </div>
          <ul className="rb-lines">
            {(more ? lines : lines.slice(0, 3)).map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          {lines.length > 3 && (
            <button className="link" onClick={() => setMore(!more)}>
              {more ? "Mostrar menos" : `Ver mais ${lines.length - 3}`}
            </button>
          )}
        </>
      ) : (
        data && <p className="muted">Juntando candles para ler este par…</p>
      )}
      {ai?.symbol === symbol && (
        <div className="rb-text">
          <small>Análise da IA</small>
          {ai.text
            .split("\n")
            .filter(Boolean)
            .map((l, i) => (
              <p key={i}>{l}</p>
            ))}
        </div>
      )}
      {error && <p className="muted">{error}</p>}
      {data?.ai && r && (
        <button className="rb-ask-ai" onClick={ask} disabled={busy}>
          <Sparkles size={14} />
          {busy ? "A IA está analisando…" : "Pedir análise da IA para este par"}
        </button>
      )}
    </section>
  );
}
