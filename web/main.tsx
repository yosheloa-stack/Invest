import "@fontsource-variable/sora";
import "./style.css";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
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
import CandleChart from "./CandleChart";
import SignalDock from "./SignalDock";
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
type Tab = "trade" | "lab" | "history" | "news" | "stats" | "system";
const TABS: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: "trade", label: "Operar", icon: CandlestickChart },
  { id: "lab", label: "Estratégias", icon: FlaskConical },
  { id: "history", label: "Histórico", icon: History },
  { id: "news", label: "Notícias", icon: Newspaper },
  { id: "stats", label: "Desempenho", icon: BarChart3 },
  { id: "system", label: "Sistema", icon: Server },
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
          setState(JSON.parse(e.data));
          setLast(Date.now());
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
    [selected, setSelected] = useState("BTCUSDT"),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const fresh = connected && now - last < 6000,
    serverNow = state ? state.time + (now - last) : now,
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
    setSelected(symbol);
    setTab("trade");
  };
  return (
    <div className="shell">
      <nav className="rail" aria-label="Principal">
        <div className="logo-mark small" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "on" : ""}
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => setTab(t.id)}
          >
            <t.icon size={20} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="page">
        <header className="top">
          <div className="brand">
            <strong>Yosh Scanner</strong>
            <span className={fresh ? "live" : "offline"}>
              {fresh ? "Ao vivo" : "Reconectando"}
            </span>
          </div>
          <div className="who">
            <span>{user.name}</span>
            <button className="icon" onClick={onLogout} aria-label="Sair">
              <LogOut size={18} />
            </button>
          </div>
        </header>
        {!fresh && state && (
          <div className="notice bad" role="alert">
            <WifiOff size={16} /> Conexão perdida. Os dados na tela podem estar
            velhos; não entre em operação até voltar.
          </div>
        )}
        <main className="content">
          {tab === "trade" && (
            <TradeView
              state={state}
              lab={lab}
              selected={asset?.symbol ?? selected}
              onSelect={setSelected}
              fresh={fresh}
              now={serverNow}
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
      <SignalDock
        signals={state?.signals || []}
        now={serverNow}
        prices={prices}
        lab={state?.strategies}
        onOpen={open}
      />
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
}: {
  state: State | null;
  lab: Lab | null;
  selected: string;
  onSelect: (s: string) => void;
  fresh: boolean;
  now: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const asset = state?.assets.find((a) => a.symbol === selected);
  const strategies = (lab?.evaluations || [])
    .filter((e) => e.symbol === selected)
    .sort((a, b) => (b.outOfSample.winRate ?? 0) - (a.outOfSample.winRate ?? 0))
    .slice(0, 6);
  const news = (state?.news || [])
    .filter((n) =>
      n.classification?.assets.some((x) => ticker(selected).startsWith(x)),
    )
    .slice(0, 3);
  if (!state)
    return (
      <div className="hero-empty">
        <Suspense fallback={null}>
          <Scene3D intensity={0.6} />
        </Suspense>
        <p>Conectando ao mercado…</p>
      </div>
    );
  return (
    <>
      <div className="assets" role="tablist" aria-label="Ativos">
        {state.assets.map((a) => (
          <button
            key={a.symbol}
            role="tab"
            aria-selected={a.symbol === selected}
            className={a.symbol === selected ? "asset on" : "asset"}
            onClick={() => onSelect(a.symbol)}
          >
            <b>{ticker(a.symbol)}</b>
            <span>{price(a.price)}</span>
            <small className={(a.change ?? 0) >= 0 ? "up" : "down"}>
              {a.change == null
                ? "—"
                : `${a.change >= 0 ? "+" : ""}${pct(a.change, 2)}`}
            </small>
          </button>
        ))}
      </div>
      {asset && (
        <div className="trade-grid">
          <section className="chart-panel">
            <Suspense fallback={null}>
              <div className="chart-backdrop">
                <Scene3D intensity={0.35} />
              </div>
            </Suspense>
            <div className="chart-head">
              <div>
                <h1>{pair(asset.symbol)}</h1>
                <span className="muted">
                  {COIN_NAMES[asset.symbol] || asset.symbol} · candles de 1
                  minuto
                </span>
              </div>
              <div className="quote">
                <strong>{price(asset.price)}</strong>
                <span className={(asset.change ?? 0) >= 0 ? "up" : "down"}>
                  {asset.change == null
                    ? "—"
                    : `${asset.change >= 0 ? "+" : ""}${pct(asset.change, 2)} na última hora`}
                </span>
              </div>
            </div>
            <CandleChart
              symbol={asset.symbol}
              live={asset.price}
              showAll={showAll}
            />
            <div className="chart-foot">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(e) => setShowAll(e.target.checked)}
                />
                <span>Mostrar gatilhos de estratégias não aprovadas</span>
              </label>
              <span className="legend">
                <i className="dot buy" /> compra <i className="dot sell" />{" "}
                venda <i className="dot gray" /> não aprovada
              </span>
            </div>
            {asset.reasons.length > 0 && (
              <p className="notice">{sentence(asset.reasons.join("; "))}</p>
            )}
          </section>
          <aside className="side">
            <section className="panel">
              <h2>Expirações</h2>
              <div className="expiries">
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
                  const label = !fresh
                    ? "Sem dados"
                    : run
                      ? `${run.direction === "COMPRA" ? "Compra" : "Venda"} em andamento`
                      : active
                        ? f.state === "COMPRA"
                          ? "Compra"
                          : "Venda"
                        : "Sem entrada";
                  return (
                    <div
                      key={f.horizon}
                      className={`expiry ${active ? (f.state === "COMPRA" ? "buy" : "sell") : ""}`}
                    >
                      <span className="mins">
                        {f.horizon}
                        <small>min</small>
                      </span>
                      <div>
                        <strong>
                          {active &&
                            (f.state === "COMPRA" ? (
                              <ArrowUpRight size={16} />
                            ) : (
                              <ArrowDownRight size={16} />
                            ))}
                          {label}
                        </strong>
                        <p>
                          {run
                            ? `Termina em ${countdown((run.due ?? now) - now)}`
                            : active
                              ? `Acerto medido ${pct(f.probability)}`
                              : sentence(f.reason)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
            <section className="panel">
              <h2>Estratégias deste ativo</h2>
              {strategies.length ? (
                <ul className="strats">
                  {strategies.map((e) => (
                    <StrategyRow
                      key={e.id + e.horizon}
                      e={e}
                      breakEven={lab!.breakEven}
                    />
                  ))}
                </ul>
              ) : (
                <p className="muted">
                  {sentence(state.strategies?.status) ||
                    "Carregando o teste das estratégias…"}
                </p>
              )}
            </section>
            {news.length > 0 && (
              <section className="panel">
                <h2>Notícias recentes</h2>
                {news.map((n) => (
                  <a
                    key={n.id}
                    className="news-mini"
                    href={n.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className={`sent ${n.classification?.sentiment}`} />
                    {n.title}
                  </a>
                ))}
              </section>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
function StrategyRow({ e, breakEven }: { e: Evaluation; breakEven: number }) {
  const wr = e.outOfSample.winRate ?? 0;
  return (
    <li className={e.approved ? "ok" : ""}>
      <div>
        <strong>{e.label}</strong>
        <span className="muted">
          {e.horizon} min · {e.outOfSample.wins + e.outOfSample.losses}{" "}
          operações no teste
        </span>
      </div>
      <div className="meter" aria-label={`Acerto ${pct(wr)}`}>
        <span
          style={{
            width: `${Math.min(100, Math.max(0, (wr - 0.35) / 0.35) * 100)}%`,
          }}
          className={wr > breakEven ? "up" : "down"}
        />
        <i style={{ left: `${((breakEven - 0.35) / 0.35) * 100}%` }} />
      </div>
      <b className={wr > breakEven ? "up" : "down"}>{pct(wr)}</b>
    </li>
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
  const signals = state?.signals || [];
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(signals, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "sinais.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const label: Record<string, string> = {
    PENDING: "Aguardando entrada",
    FILLED: "Em andamento",
    INVALIDATED: "Cancelado",
    EXPIRED: "Expirou sem entrada",
    NO_DATA: "Sem cotação no fim",
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Sinais emitidos</h2>
        <button className="ghost" onClick={download} disabled={!signals.length}>
          <Download size={16} /> Exportar
        </button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Hora</th>
              <th>Ativo</th>
              <th>Direção</th>
              <th>Exp.</th>
              <th>Entrada</th>
              <th>Saída</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {signals.map((s) => (
              <tr key={s.id}>
                <td>{clock(s.t)}</td>
                <td>{ticker(s.symbol)}</td>
                <td className={s.direction === "COMPRA" ? "up" : "down"}>
                  {s.direction === "COMPRA" ? "Compra" : "Venda"}
                </td>
                <td>{s.horizon} min</td>
                <td>{price(s.entry)}</td>
                <td>{price(s.exit)}</td>
                <td
                  className={
                    s.result === "WIN"
                      ? "up"
                      : s.result === "LOSS"
                        ? "down"
                        : ""
                  }
                >
                  {s.result === "WIN"
                    ? "Ganhou"
                    : s.result === "LOSS"
                      ? "Perdeu"
                      : s.result === "NEUTRO"
                        ? "Empate"
                        : label[s.status] || s.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!signals.length && (
        <p className="muted pad">
          Nenhum sinal ainda. Eles aparecem aqui quando uma estratégia aprovada
          dispara.
        </p>
      )}
    </section>
  );
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
function StatsView({ state }: { state: State | null }) {
  const m = state?.metrics,
    [group, setGroup] = useState<
      "byAsset" | "byHorizon" | "byHour" | "byStrategy"
    >("byAsset");
  const groups = (m?.[group] || {}) as Record<string, Metric>;
  return (
    <>
      <section className="stats">
        <div>
          <span>Acerto real</span>
          <strong>{pct(m?.winRate)}</strong>
          <small>precisa passar de {pct(m?.breakEven)}</small>
        </div>
        <div>
          <span>Ganhos / perdas</span>
          <strong>{m ? `${m.wins} / ${m.losses}` : "—"}</strong>
          <small>{m?.neutrals ?? 0} empates</small>
        </div>
        <div>
          <span>Saldo em unidades</span>
          <strong className={(m?.paperUnits ?? 0) >= 0 ? "up" : "down"}>
            {m ? m.paperUnits.toFixed(2).replace(".", ",") : "—"}
          </strong>
          <small>1 unidade por entrada</small>
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
              </tr>
            </thead>
            <tbody>
              {Object.entries(groups).map(([k, v]) => (
                <tr key={k}>
                  <td>{k.replace("estrategia:", "")}</td>
                  <td>{v.count}</td>
                  <td>{v.wins}</td>
                  <td>{v.losses}</td>
                  <td>{pct(v.winRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!m?.count && (
          <p className="muted pad">
            Os resultados aparecem depois que os primeiros sinais vencerem.
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
          <dd>Binance spot ao vivo; EUR/USD vem do par EUR/USDT</dd>
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
