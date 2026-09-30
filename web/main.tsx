import SignalHistory from "./SignalHistory";
import OperationPlan from "./OperationPlan";
import { PatternPanel, RadarPanel } from "./Radar";
import { Radar as RadarIcon } from "lucide-react";
import { useChartFullscreen } from "./useChartFullscreen";
import "./style.css";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BrainCircuit,
  ChartCandlestick,
  ChartColumnIncreasing,
  ScrollText,
  Settings2,
  Box,
  Bot,
  List,
  ChevronDown,
  CandlestickChart,
  Download,
  ExternalLink,
  FlaskConical,
  History,
  LogOut,
  Newspaper,
  Server,
  WifiOff,
} from "lucide-react";
import Auth from "./Auth";
import SignalActivity from "./SignalActivity";
import { BrandMark, CoinIcon } from "./Icons";
import ThemeToggle from "./ThemeToggle";
import { lastMove, liveBar, pushTick, useTicks, lastServerTime } from "./live";
import { FAMILY_TEXT, directionText } from "./studies";
import CandleChart from "./CandleChart";
import SignalDock from "./SignalDock";
import {
  RobotAlerts,
  RobotLive,
  RobotSide,
  money,
  robotStudies,
  useRobotRead,
} from "./RobotView";
import {
  api,
  clock,
  countdown,
  sentence,
  COIN_NAMES,
  pair,
  pct,
  price,
  ticker,
} from "./format";
import type { Evaluation, Lab, Metric, News, State, User } from "./types";
const Scene3D = lazy(() => import("./Scene3D"));
const Market3D = lazy(() => import("./Market3D"));
type Tab = "trade" | "lab" | "history" | "news" | "stats" | "system";
const TABS: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: "trade", label: "Operar", icon: ChartCandlestick },
  { id: "lab", label: "Estratégias", icon: BrainCircuit },
  { id: "history", label: "Histórico", icon: ScrollText },
  { id: "news", label: "Notícias", icon: Newspaper },
  { id: "stats", label: "Desempenho", icon: ChartColumnIncreasing },
  { id: "system", label: "Sistema", icon: Settings2 },
];
function useLiveState(enabled: boolean) {
  const [state, setState] = useState<State | null>(null),
    [connected, setConnected] = useState(false),
    [last, setLast] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let stop = false,
      ws: WebSocket | undefined,
      retry: ReturnType<typeof setTimeout>;
    const open = () => {
      if (stop) return;
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
      );
      ws.onopen = () => setConnected(true);
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "tick") pushTick(msg);
          else {
            setState(msg);
            setLast(Date.now());
          }
        } catch {
          /* ignore malformed frame */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!stop) retry = setTimeout(open, 2000);
      };
      ws.onerror = () => ws?.close();
    };
    open();
    return () => {
      stop = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [enabled]);
  return { state, connected, last };
}
function useLab(enabled: boolean) {
  const [lab, setLab] = useState<Lab | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const load = () =>
      api<Lab>("/api/strategies")
        .then((x) => !stop && setLab(x))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 60000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [enabled]);
  return lab;
}
function Root() {
  const [user, setUser] = useState<User | null | undefined>(undefined),
    [allowSignup, setAllowSignup] = useState(true);
  useEffect(() => {
    api<{ user: User; allowSignup: boolean }>("/api/auth/me")
      .then((r) => {
        setUser(r.user);
        setAllowSignup(r.allowSignup);
      })
      .catch((e) => {
        setAllowSignup(e?.body?.allowSignup ?? true);
        setUser(null);
      });
  }, []);
  if (user === undefined) return <div className="boot" />;
  if (!user) return <Auth allowSignup={allowSignup} onLogin={setUser} />;
  return (
    <Dashboard
      user={user}
      onLogout={async () => {
        await api("/api/auth/logout", { method: "POST" }).catch(
          () => undefined,
        );
        setUser(null);
      }}
    />
  );
}
function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const { state, connected, last } = useLiveState(true),
    lab = useLab(true),
    [tab, setTab] = useState<Tab>("trade"),
    [selected, setSelected] = useState(() => {
      try {
        return localStorage.getItem("yosh-asset") || "BTCUSDT";
      } catch {
        return "BTCUSDT";
      }
    }),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const select = (s: string) => {
    setSelected(s);
    try {
      localStorage.setItem("yosh-asset", s);
    } catch {
      /* private mode */
    }
  };
  const fresh = connected && now - last < 6000,
    serverNow = lastServerTime() || (state ? state.time + (now - last) : now),
    asset =
      state?.assets.find((a) => a.symbol === selected) ?? state?.assets[0],
    prices = useMemo(
      () =>
        Object.fromEntries(
          (state?.assets || []).map((a) => [a.symbol, a.price]),
        ),
      [state],
    );
  const open = (symbol: string) => {
    select(symbol);
    setTab("trade");
  };
  return (
    <div className="shell">
      <nav className="rail" aria-label="Principal">
        <div className="rail-brand">
          <BrandMark size={30} />
        </div>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "on" : ""}
            aria-current={tab === t.id ? "page" : undefined}
            aria-label={t.label}
            data-tip={t.label}
            onClick={() => setTab(t.id)}
          >
            <t.icon size={20} strokeWidth={1.6} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="page">
        <header className="top">
          <div className="brand">
            <BrandMark size={22} />
            <strong>Yosh</strong>
            <span>Scanner</span>
          </div>
          <TickerTape state={state} onOpen={open} />
          <div className="top-right">
            <span
              className={`conn ${fresh && asset?.feed === "CONECTADO" ? "live" : "off"}`}
            >
              <i />
              {!fresh
                ? "Reconectando"
                : asset?.feed === "CONECTADO"
                  ? "Ao vivo"
                  : "Dados indisponíveis"}
            </span>
            <span className="clock">{clock(serverNow)}</span>
            <span className="who">{user.name.split(" ")[0]}</span>
            <ThemeToggle />
            <button className="icon" onClick={onLogout} aria-label="Sair">
              <LogOut size={17} />
            </button>
          </div>
        </header>
        {!fresh && state && (
          <div className="notice bad" role="alert">
            <WifiOff size={16} /> Conexão perdida. Os dados na tela podem estar
            velhos; não entre em operação até voltar.
          </div>
        )}
        <main className={`content tab-${tab}`}>
          {tab === "trade" && (
            <TradeView
              state={state}
              lab={lab}
              selected={asset?.symbol ?? selected}
              onSelect={select}
              fresh={fresh}
              now={serverNow}
              user={user}
              onOpen={open}
            />
          )}
          {tab === "lab" && <LabView lab={lab} onOpen={open} />}
          {tab === "history" && <HistoryView state={state} />}
          {tab === "news" && <NewsView state={state} />}
          {tab === "stats" && <StatsView state={state} />}
          {tab === "system" && (
            <SystemView state={state} user={user} lab={lab} />
          )}
        </main>
      </div>
      <RobotAlerts robot={state?.robot} now={serverNow} onOpen={open} />
      <SignalDock
        signals={state?.signals || []}
        fresh={fresh}
        now={serverNow}
        prices={prices}
        lab={state?.strategies}
        onOpen={open}
      />
    </div>
  );
}
// Live price with a brief flash in the direction of the last change.
function LivePrice({
  symbol,
  fallback,
  className = "",
}: {
  symbol: string;
  fallback: number | null;
  className?: string;
}) {
  useTicks();
  const c = liveBar(symbol)?.c ?? fallback,
    m = lastMove(symbol);
  return (
    <span
      key={String(c)}
      className={`lp ${m > 0 ? "flash-up" : m < 0 ? "flash-down" : ""} ${className}`}
    >
      {price(c)}
    </span>
  );
}
// Change over the last hour, recomputed against the live price.
function liveChange(a: State["assets"][number]) {
  const c = liveBar(a.symbol)?.c;
  if (a.change == null || a.price == null || c == null) return a.change;
  return c / (a.price / (1 + a.change)) - 1;
}
const signed = (x: number | null | undefined) =>
  x == null ? "—" : `${x >= 0 ? "+" : ""}${pct(x, 2)}`;
function TickerTape({
  state,
  onOpen,
}: {
  state: State | null;
  onOpen: (s: string) => void;
}) {
  useTicks();
  const list = state?.assets || [];
  if (!list.length) return <div className="tape" />;
  const row = (dup: boolean) =>
    list.map((a) => {
      const ch = liveChange(a);
      return (
        <button
          key={a.symbol + dup}
          tabIndex={dup ? -1 : 0}
          aria-hidden={dup || undefined}
          onClick={() => onOpen(a.symbol)}
        >
          <CoinIcon symbol={a.symbol} size={16} />
          <b>{ticker(a.symbol)}</b>
          {price(liveBar(a.symbol)?.c ?? a.price)}
          <em className={(ch ?? 0) >= 0 ? "up" : "down"}>{signed(ch)}</em>
        </button>
      );
    });
  return (
    <div className="tape" aria-label="Cotações ao vivo">
      <div className="tape-track">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
type SideTab = "robot" | "radar" | "strat" | "list" | "map" | "news";
function SymbolPicker({
  state,
  selected,
  onSelect,
}: {
  state: State;
  selected: string;
  onSelect: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tv-menu-wrap">
      <button
        className="tv-symbol"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <CoinIcon symbol={selected} size={22} />
        {pair(selected).replace("/", "")}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="tv-menu tv-symbols" role="menu">
          {state.assets.map((a) => (
            <button
              key={a.symbol}
              role="menuitem"
              className={a.symbol === selected ? "on" : ""}
              onClick={() => {
                onSelect(a.symbol);
                setOpen(false);
              }}
            >
              <CoinIcon symbol={a.symbol} size={20} />
              <b>{pair(a.symbol).replace("/", "")}</b>
              <span>{COIN_NAMES[a.symbol]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function Watchlist({
  state,
  selected,
  onSelect,
}: {
  state: State;
  selected: string;
  onSelect: (s: string) => void;
}) {
  useTicks();
  return (
    <div className="tv-watch">
      <div className="tv-watch-head">
        <span>Símbolo</span>
        <span>Último</span>
        <span>Var. 1h</span>
      </div>
      <div role="tablist" aria-label="Ativos" className="tv-watch-rows">
        {state.assets.map((a) => {
          const ch = liveChange(a);
          return (
            <button
              key={a.symbol}
              role="tab"
              aria-selected={a.symbol === selected}
              className={a.symbol === selected ? "on" : ""}
              onClick={() => onSelect(a.symbol)}
            >
              <span className="w-sym">
                <CoinIcon symbol={a.symbol} size={20} />
                {ticker(a.symbol)}
              </span>
              <LivePrice symbol={a.symbol} fallback={a.price} />
              <span className={(ch ?? 0) >= 0 ? "up" : "down"}>
                {signed(ch)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
function TradeView({
  state,
  lab,
  selected,
  onSelect,
  fresh,
  now,
  user,
  onOpen,
}: {
  user: User;
  onOpen: (s: string) => void;
  state: State | null;
  lab: Lab | null;
  selected: string;
  onSelect: (s: string) => void;
  fresh: boolean;
  now: number;
}) {
  useTicks();
  const fullscreen = useChartFullscreen();
  const [focusId, setFocusId] = useState<string | null>(null),
    [side, setSide] = useState<SideTab>("robot"),
    robotRead = useRobotRead(selected);
  // Trades pushed over the socket show up at once; the per-pair read refreshes every 15s.
  const liveOpenKey = JSON.stringify(
    (state?.robot?.open || [])
      .filter((t) => t.symbol === selected)
      .map((t) => t.id),
  );
  const robotTrades = useMemo(() => {
    const liveOpen = (state?.robot?.open || []).filter(
      (t) => t.symbol === selected,
    );
    return [
      ...liveOpen,
      ...(robotRead?.trades || []).filter(
        (t) => !liveOpen.some((o) => o.id === t.id) && t.status !== "ABERTA",
      ),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveOpenKey, robotRead, selected]);
  const robotView = useMemo(
    () => robotRead && { ...robotRead, trades: robotTrades },
    [robotRead, robotTrades],
  );
  const robotUses = robotStudies(robotView),
    robotLevels = robotView?.read
      ? {
          support: robotView.read.support,
          resistance: robotView.read.resistance,
        }
      : undefined;
  const evals = useMemo(
    () =>
      (lab?.evaluations || [])
        .filter((e) => e.symbol === selected)
        .sort(
          (a, b) =>
            Number(b.approved) - Number(a.approved) ||
            (b.outOfSample.winRate ?? 0) - (a.outOfSample.winRate ?? 0),
        ),
    [lab, selected],
  );
  useEffect(() => setFocusId(null), [selected]);
  const focus =
    evals.find((e) => `${e.id}|${e.horizon}` === focusId) ?? evals[0];
  const asset = state?.assets.find((a) => a.symbol === selected);
  if (!state || !asset)
    return (
      <div className="hero-empty">
        <Suspense fallback={null}>
          <Scene3D intensity={0.8} />
        </Suspense>
        <p>Conectando ao mercado…</p>
      </div>
    );
  const ch = liveChange(asset),
    news = (state.news || [])
      .filter((n) =>
        n.classification?.assets.some((x) => ticker(selected).startsWith(x)),
      )
      .slice(0, 6);
  const SIDE: { id: SideTab; label: string; icon: typeof Activity }[] = [
    { id: "robot", label: "Robô", icon: Bot },
    { id: "radar", label: "Radar", icon: RadarIcon },
    { id: "strat", label: "Estratégias", icon: BrainCircuit },
    { id: "list", label: "Ativos", icon: List },
    { id: "map", label: "Mapa 3D", icon: Box },
    { id: "news", label: "Notícias", icon: Newspaper },
  ];
  return (
    <div className="tv">
      <section
        ref={fullscreen.root}
        className={`tv-center ${fullscreen.expanded ? "chart-expanded" : ""}`}
        role={fullscreen.expanded ? "dialog" : undefined}
        aria-modal={fullscreen.expanded || undefined}
        aria-label={fullscreen.expanded ? "Gráfico em tela cheia" : undefined}
      >
        <CandleChart
          expanded={fullscreen.expanded}
          onExpand={fullscreen.toggle}
          key={asset.symbol}
          symbol={asset.symbol}
          title={pair(asset.symbol).replace("/", "")}
          focus={focus}
          robotTrades={robotTrades}
          robotStudies={robotUses}
          robotLevels={robotLevels}
          patternLevels={
            robotView?.patterns?.charts.find((p) => p.status === "formando") ??
            null
          }
          signals={state.signals.filter((s) => s.symbol === asset.symbol)}
          head={
            <SymbolPicker
              state={state}
              selected={selected}
              onSelect={onSelect}
            />
          }
        />
        <RobotLive symbol={asset.symbol} data={robotView} now={now} />
        <PatternPanel patterns={robotView?.patterns} />
        <OperationPlan
          asset={asset}
          signals={state.signals}
          now={now}
          fresh={fresh}
        />
        <SignalActivity
          asset={asset}
          signals={state.signals}
          metrics={state.metrics}
          now={now}
          fresh={fresh}
        />
        {asset.symbol === "EURUSDT" && (
          <p className="notice">
            Fonte: Binance spot · EUR/USDT (Euro/Tether). Este gráfico não é
            Forex EUR/USD.
          </p>
        )}
        {asset.reasons.length > 0 && (
          <p className="notice">{sentence(asset.reasons.join("; "))}</p>
        )}
      </section>
      <aside className="tv-side">
        <div className="tv-details">
          <div className="tv-quote">
            <div>
              <b>{pair(asset.symbol).replace("/", "")}</b>
              <span className="muted">{COIN_NAMES[asset.symbol]}</span>
            </div>
            <div className="tv-quote-num">
              <LivePrice
                symbol={asset.symbol}
                fallback={asset.price}
                className="big"
              />
              <span className={(ch ?? 0) >= 0 ? "up" : "down"}>
                {signed(ch)}
              </span>
            </div>
          </div>
          <section className="side-block">
            <h3>Sinal por expiração</h3>
            <Expiries state={state} asset={asset} fresh={fresh} now={now} />
          </section>
          <div className="tv-tabs" role="tablist">
            {SIDE.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={side === t.id}
                className={side === t.id ? "on" : ""}
                onClick={() => setSide(t.id)}
              >
                <t.icon size={15} /> {t.label}
              </button>
            ))}
          </div>
          {side === "robot" && (
            <RobotSide
              robot={state.robot}
              user={user}
              now={now}
              onOpen={onOpen}
            />
          )}
          {side === "radar" && <RadarPanel onSelect={onSelect} now={now} />}
          {side === "list" && (
            <Watchlist state={state} selected={selected} onSelect={onSelect} />
          )}
          {side === "strat" && (
            <StrategyPanel
              evals={evals}
              lab={lab}
              focus={focus}
              onFocus={(e) => setFocusId(`${e.id}|${e.horizon}`)}
              status={state.strategies?.status}
            />
          )}
          {side === "map" && (
            <section className="map-panel">
              <span className="muted">
                Cada coluna é um ativo; a altura é o movimento da última hora.
                Clique para abrir.
              </span>
              <Suspense fallback={<div className="m3d" />}>
                <Market3D
                  items={state.assets.map((a) => ({
                    symbol: a.symbol,
                    change: a.change,
                  }))}
                  selected={selected}
                  onSelect={onSelect}
                />
              </Suspense>
            </section>
          )}
          {side === "news" && (
            <section className="tv-news">
              {news.length ? (
                news.map((n) => (
                  <a
                    key={n.id}
                    className="news-mini"
                    href={n.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className={`sent ${n.classification?.sentiment}`} />
                    <span>
                      {n.title}
                      <small>
                        {n.source} · {clock(n.publishedAt)}
                      </small>
                    </span>
                  </a>
                ))
              ) : (
                <p className="muted pad">
                  Nenhuma notícia recente sobre {ticker(selected)}.
                </p>
              )}
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
function Expiries({
  state,
  asset,
  fresh,
  now,
}: {
  state: State;
  asset: State["assets"][number];
  fresh: boolean;
  now: number;
}) {
  return (
    <div className="expiries" aria-label="Expirações">
      {asset.forecasts.map((f) => {
        const active =
          fresh &&
          f.signal &&
          f.signal.status === "PENDING" &&
          f.signal.expires > now;
        const run = state.signals.find(
          (x) =>
            x.symbol === asset.symbol &&
            x.horizon === f.horizon &&
            x.status === "FILLED",
        );
        const dir = run?.direction ?? (active ? f.state : null),
          cls = dir === "COMPRA" ? "buy" : dir === "VENDA" ? "sell" : "";
        return (
          <div
            key={f.horizon}
            className={`expiry ${cls}`}
            title={sentence(f.reason)}
          >
            <span className="mins">{f.horizon} min</span>
            <strong>
              {dir === "COMPRA" ? (
                <ArrowUpRight size={15} />
              ) : dir === "VENDA" ? (
                <ArrowDownRight size={15} />
              ) : null}
              {!fresh
                ? "Sem dados"
                : run
                  ? `${run.direction === "COMPRA" ? "Compra" : "Venda"} ${countdown((run.due ?? now) - now)}`
                  : active
                    ? dir === "COMPRA"
                      ? "Compra"
                      : "Venda"
                    : "Aguardando"}
            </strong>
          </div>
        );
      })}
    </div>
  );
}
function StrategyPanel({
  evals,
  lab,
  focus,
  onFocus,
  status,
}: {
  evals: Evaluation[];
  lab: Lab | null;
  focus?: Evaluation;
  onFocus: (e: Evaluation) => void;
  status?: string;
}) {
  const [h, setH] = useState<number | "all">("all"),
    [all, setAll] = useState(false);
  const matching = evals.filter((e) => h === "all" || e.horizon === h),
    rows = all ? matching : matching.slice(0, 8),
    approved = evals.filter((e) => e.approved).length,
    be = lab?.breakEven ?? 0.5556;
  return (
    <section className="strat-panel">
      <header className="panel-head">
        <div>
          <span className="muted">
            {evals.length
              ? `${approved} aprovada(s) de ${evals.length} testadas neste ativo`
              : sentence(status) || "Carregando o teste…"}
          </span>
        </div>
        <div className="seg" role="group" aria-label="Expiração">
          {(["all", 5, 10, 15] as const).map((x) => (
            <button
              key={x}
              aria-pressed={h === x}
              className={h === x ? "on" : ""}
              onClick={() => setH(x)}
            >
              {x === "all" ? "Todas" : `${x}m`}
            </button>
          ))}
        </div>
      </header>
      {focus && (
        <div className="strat-focus">
          <strong>{focus.label}</strong>
          <p>
            {FAMILY_TEXT[focus.id.split(":")[0]] || ""}{" "}
            {directionText(focus.id)} As setas no gráfico mostram onde ela
            disparou, com Compra ou Venda e a expiração.
          </p>
          <dl>
            <div>
              <dt>Acerto no teste</dt>
              <dd
                className={
                  (focus.outOfSample.winRate ?? 0) > be ? "up" : "down"
                }
              >
                {pct(focus.outOfSample.winRate)}
              </dd>
            </div>
            <div>
              <dt>Mínimo com 95%</dt>
              <dd>{pct(focus.outOfSample.lower)}</dd>
            </div>
            <div>
              <dt>Operações</dt>
              <dd>{focus.outOfSample.wins + focus.outOfSample.losses}</dd>
            </div>
          </dl>
          <p className={`verdict ${focus.approved ? "ok" : ""}`}>
            {focus.approved
              ? "Aprovada: emite aviso quando disparar."
              : `Reprovada: ${sentence(focus.reason).toLowerCase() || "não passou do empate"}. Não emite aviso.`}
          </p>
        </div>
      )}
      <ul className="strats">
        {rows.map((e) => {
          const wr = e.outOfSample.winRate ?? 0,
            on = focus && e.id === focus.id && e.horizon === focus.horizon;
          return (
            <li key={e.id + e.horizon}>
              <button
                className={`${on ? "on" : ""} ${e.approved ? "ok" : ""}`}
                aria-pressed={!!on}
                onClick={() => onFocus(e)}
              >
                <span className="s-name">
                  <b>{e.label}</b>
                  <small>
                    {e.horizon} min ·{" "}
                    {e.outOfSample.wins + e.outOfSample.losses} operações
                  </small>
                </span>
                <span className="meter" aria-hidden="true">
                  <span
                    className={wr > be ? "up" : "down"}
                    style={{
                      width: `${Math.min(100, Math.max(0, (wr - 0.35) / 0.35) * 100)}%`,
                    }}
                  />
                  <i style={{ left: `${((be - 0.35) / 0.35) * 100}%` }} />
                </span>
                <b className={`s-wr ${wr > be ? "up" : "down"}`}>{pct(wr)}</b>
              </button>
            </li>
          );
        })}
      </ul>
      {matching.length > 8 && (
        <button className="ghost more" onClick={() => setAll(!all)}>
          {all
            ? "Mostrar só as 8 melhores"
            : `Mostrar todas (${matching.length})`}
        </button>
      )}
      {!rows.length && evals.length > 0 && (
        <p className="muted pad">Nenhuma estratégia nesta expiração.</p>
      )}
    </section>
  );
}
function LabView({
  lab,
  onOpen,
}: {
  lab: Lab | null;
  onOpen: (s: string) => void;
}) {
  const [filter, setFilter] = useState("todos");
  const rows = (lab?.evaluations || []).filter(
    (e) => filter === "todos" || e.symbol === filter,
  );
  const symbols = [...new Set((lab?.evaluations || []).map((e) => e.symbol))];
  return (
    <>
      <section className="lab-hero">
        <div>
          <h1>
            {lab
              ? `${lab.approved} de ${lab.tested} aprovadas`
              : "Testando estratégias…"}
          </h1>
          <p>
            Cada estratégia escolhe seus ajustes nos primeiros 60% do histórico
            e é julgada uma única vez nos 40% finais, que ela nunca viu. Só vira
            sinal com 100 ou mais operações no teste e acerto mínimo, com 95% de
            confiança, acima de {pct(lab?.breakEven)} (o empate com payout de{" "}
            {pct(lab?.payout, 0)}).
          </p>
        </div>
        <dl>
          <div>
            <dt>Histórico</dt>
            <dd>
              {lab?.historyFrom
                ? `${new Date(lab.historyFrom).toLocaleDateString("pt-BR")} a ${new Date(lab.historyTo!).toLocaleDateString("pt-BR")}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Fonte</dt>
            <dd>
              {lab?.sources
                ? [...new Set(Object.values(lab.sources))].join(", ") || "—"
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Situação</dt>
            <dd>{sentence(lab?.status) || "—"}</dd>
          </div>
        </dl>
      </section>
      <div className="filters">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Ativo"
        >
          <option value="todos">Todos os ativos</option>
          {symbols.map((s) => (
            <option key={s} value={s}>
              {pair(s)}
            </option>
          ))}
        </select>
      </div>
      <div className="table-scroll panel">
        <table>
          <thead>
            <tr>
              <th>Ativo</th>
              <th>Exp.</th>
              <th>Estratégia</th>
              <th>Operações</th>
              <th>Acerto no teste</th>
              <th>Mínimo (95%)</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr
                key={e.symbol + e.horizon + e.id}
                className={e.approved ? "ok" : ""}
              >
                <td>
                  <button className="link" onClick={() => onOpen(e.symbol)}>
                    {ticker(e.symbol)}
                  </button>
                </td>
                <td>{e.horizon} min</td>
                <td>{e.label}</td>
                <td>{e.outOfSample.wins + e.outOfSample.losses}</td>
                <td
                  className={
                    (e.outOfSample.winRate ?? 0) > lab!.breakEven
                      ? "up"
                      : "down"
                  }
                >
                  {pct(e.outOfSample.winRate)}
                </td>
                <td>{pct(e.outOfSample.lower)}</td>
                <td>{e.approved ? "Aprovada" : sentence(e.reason)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="muted pad">
            O servidor está baixando o histórico e testando. Leva alguns minutos
            após iniciar.
          </p>
        )}
      </div>
    </>
  );
}
function HistoryView({ state }: { state: State | null }) {
  return <SignalHistory live={state?.signals || []} />;
}
function NewsView({ state }: { state: State | null }) {
  const news: News[] = state?.news || [];
  const sent: Record<string, string> = {
    positive: "Positiva",
    negative: "Negativa",
    neutral: "Neutra",
    mixed: "Mista",
  };
  return (
    <>
      <p className="notice">
        {sentence(state?.newsStatus) || "Carregando notícias…"}
      </p>
      <div className="news-grid">
        {news.map((n) => (
          <article key={n.id} className="news">
            <span className="muted">
              {n.source} · {clock(n.publishedAt)}
            </span>
            <a href={n.url} target="_blank" rel="noreferrer">
              <h3>
                {n.title} <ExternalLink size={14} />
              </h3>
            </a>
            {n.classification && (
              <div className="tags">
                <span className={`sent-tag ${n.classification.sentiment}`}>
                  {sent[n.classification.sentiment]}
                </span>
                {n.classification.assets.map((a) => (
                  <span key={a}>{a === "MARKET" ? "Mercado" : a}</span>
                ))}
                <span>Impacto {n.classification.impact_score}/10</span>
              </div>
            )}
          </article>
        ))}
      </div>
      {!news.length && (
        <p className="muted pad">
          Nenhuma notícia recebida ainda. As fontes são consultadas a cada 30
          segundos.
        </p>
      )}
    </>
  );
}
type Perf = {
  count: number;
  wins: number;
  losses: number;
  neutrals: number;
  winRate: number | null;
  maxLossStreak: number;
  profit: number;
};
type Performance = Perf & {
  open: number;
  breakEven: number;
  byAsset: Record<string, Perf>;
  byHorizon: Record<string, Perf>;
  byHour: Record<string, Perf>;
  byStrategy: Record<string, Perf>;
};
// The robot's own simulated trades; refreshes whenever one opens or closes.
function StatsView({ state }: { state: State | null }) {
  const [m, setM] = useState<Performance | null>(null),
    [error, setError] = useState(""),
    [group, setGroup] = useState<
      "byAsset" | "byHorizon" | "byHour" | "byStrategy"
    >("byAsset"),
    r = state?.robot,
    key = `${r?.stats.trades ?? 0}:${r?.open.length ?? 0}`;
  useEffect(() => {
    let live = true;
    const load = () =>
      api<Performance>("/api/robot/performance")
        .then((x) => live && (setM(x), setError("")))
        .catch((e) => live && setError(String(e.message || e)));
    void load();
    const id = setInterval(load, 15000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [key]);
  const groups = m?.[group] || {};
  return (
    <>
      <section className="stats">
        <div>
          <span>Acerto do robô</span>
          <strong
            className={
              m?.winRate == null ? "" : m.winRate > m.breakEven ? "up" : "down"
            }
          >
            {pct(m?.winRate)}
          </strong>
          <small>precisa passar de {pct(m?.breakEven)}</small>
        </div>
        <div>
          <span>Ganhos / perdas</span>
          <strong>{m ? `${m.wins} / ${m.losses}` : "—"}</strong>
          <small>
            {m?.neutrals ?? 0} empates · {m?.open ?? 0} aberta(s)
          </small>
        </div>
        <div>
          <span>Lucro simulado</span>
          <strong className={(m?.profit ?? 0) >= 0 ? "up" : "down"}>
            {money(m?.profit, true)}
          </strong>
          <small>banca {money(r?.stats.balance)}</small>
        </div>
        <div>
          <span>Pior sequência</span>
          <strong>{m?.maxLossStreak ?? "—"}</strong>
          <small>perdas seguidas</small>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Resultado por grupo</h2>
          <select
            value={group}
            onChange={(e) => setGroup(e.target.value as typeof group)}
            aria-label="Agrupar"
          >
            <option value="byAsset">Ativo</option>
            <option value="byHorizon">Expiração</option>
            <option value="byHour">Hora</option>
            <option value="byStrategy">Estratégia</option>
          </select>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Grupo</th>
                <th>Entradas</th>
                <th>Ganhos</th>
                <th>Perdas</th>
                <th>Acerto</th>
                <th>Lucro</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(groups).map(([k, v]) => (
                <tr key={k}>
                  <td>{group === "byAsset" ? pair(k) : k}</td>
                  <td>{v.count}</td>
                  <td>{v.wins}</td>
                  <td>{v.losses}</td>
                  <td>{pct(v.winRate)}</td>
                  <td className={v.profit >= 0 ? "up" : "down"}>
                    {money(v.profit, true)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!m?.count && (
          <p className="muted pad">
            {error ||
              "Os resultados aparecem aqui quando as operações do robô vencerem."}
          </p>
        )}
      </section>
    </>
  );
}
function SystemView({
  state,
  user,
  lab,
}: {
  state: State | null;
  user: User;
  lab: Lab | null;
}) {
  return (
    <section className="panel">
      <h2>Sistema</h2>
      <dl className="kv">
        <div>
          <dt>Conta</dt>
          <dd>
            {user.name} ({user.email})
            {user.role === "admin" ? " · administrador" : ""}
          </dd>
        </div>
        <div>
          <dt>Banco de dados</dt>
          <dd>{state?.database || "—"}</dd>
        </div>
        <div>
          <dt>Mercado</dt>
          <dd>Binance spot · EUR/USDT é Euro/Tether, não Forex EUR/USD</dd>
        </div>
        <div>
          <dt>Notícias</dt>
          <dd>{sentence(state?.newsStatus) || "—"}</dd>
        </div>
        <div>
          <dt>Estratégias</dt>
          <dd>{sentence(lab?.status) || "—"}</dd>
        </div>
        <div>
          <dt>Modo</dt>
          <dd>Paper: o sistema avisa, nenhuma ordem é enviada</dd>
        </div>
      </dl>
      {user.role === "admin" && (
        <a className="ghost" href="/api/backup">
          <Download size={16} /> Baixar backup do banco
        </a>
      )}
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<Root />);
