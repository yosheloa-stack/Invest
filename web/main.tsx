import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  ArrowRight,
  BarChart3,
  Check,
  ChevronRight,
  Clock3,
  Database,
  Download,
  ExternalLink,
  Layers3,
  Newspaper,
  Radio,
  ShieldCheck,
  Target,
  WifiOff,
  X,
} from "lucide-react";
import "./style.css";
type Signal = {
  id: string;
  symbol: string;
  t: number;
  horizon: number;
  direction: string;
  status: string;
  entryLow: number;
  entryHigh: number;
  expires: number;
  probability: number;
  entry?: number;
  exit?: number;
  result?: string;
  return?: number;
  modelId: string;
};
type Forecast = {
  horizon: number;
  state: string;
  reason: string;
  probability: number | null;
  favorable: string[];
  contrary: string[];
  signal?: Signal;
};
type Asset = {
  symbol: string;
  price: number | null;
  change: number | null;
  feed: string;
  reasons: string[];
  eventTime: number | null;
  chart: { t: number; p: number }[];
  indicators: Record<string, number> | null;
  features: Record<string, number | string | boolean> | null;
  groups: Record<string, number> | null;
  forecasts: Forecast[];
};
type Metric = {
  count: number;
  wins: number;
  losses: number;
  neutrals: number;
  winRate: number | null;
  maxLossStreak: number;
  paperUnits: number;
};
type News = {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: number;
  availableAt: number | null;
  classification: null | {
    assets: string[];
    sentiment: string;
    impact_score: number;
    confidence: number;
    summary: string;
    reasoning_summary: string;
  };
  reactions: {
    symbol: string;
    horizon: number;
    return: number | null;
    status: string;
  }[];
};
type State = {
  time: number;
  mode: string;
  sniper: boolean;
  database: string;
  newsStatus: string;
  newsCapabilities: { semanticDedup: string; classification: string };
  newsLastSuccess: number;
  assets: Asset[];
  metrics:
    | null
    | (Metric & {
        total: number;
        pending: number;
        noData: number;
        invalidated: number;
        payout: number;
        breakEven: number;
        byAsset: Record<string, Metric>;
        byHorizon: Record<string, Metric>;
        byHour: Record<string, Metric>;
        byStrategy: Record<string, Metric>;
        byNews: Record<string, Metric>;
        calibration: {
          from: number;
          to: number;
          count: number;
          predicted: number | null;
          observed: number | null;
        }[];
        observations: { status: string; count: number }[];
      });
  signals: Signal[];
  news: News[];
  models: {
    id: string;
    symbol: string;
    horizon: number;
    sampleCount: number;
    testCount: number;
    testEnd: number;
    metrics: { brier: number; ece: number; logLoss: number };
  }[];
  modelErrors: Record<string, string>;
  strategies?: Lab;
};
type Tally = {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  lower: number | null;
};
type Lab = {
  status: string;
  error: string | null;
  updatedAt: number | null;
  historyFrom: number | null;
  historyTo: number | null;
  breakEven: number;
  minTrades: number;
  tested: number;
  approved: number;
  evaluations: {
    symbol: string;
    horizon: number;
    id: string;
    label: string;
    inSample: Tally;
    outOfSample: Tally;
    halves: [Tally, Tally];
    approved: boolean;
    reason: string;
  }[];
};
const money = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);
const percent = (n: number | null | undefined) =>
  n == null ? "—" : `${(n * 100).toFixed(2)}%`;
const number = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const time = (n: number) =>
  new Date(n).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const names: Record<string, string> = {
  trend: "Tendência",
  momentum: "Momentum",
  structure: "Estrutura",
  volume: "Volume",
  flow: "Trades + livro parcial",
  mtf: "Multi-timeframe",
  news: "Notícias",
  reaction: "Reação observada",
};
function Spark({ points }: { points: { t: number; p: number }[] }) {
  if (points.length < 2)
    return <div className="empty-chart">Aguardando candles reais</div>;
  const min = Math.min(...points.map((p) => p.p)),
    max = Math.max(...points.map((p) => p.p));
  const coords = points
    .map(
      (p, i) =>
        `${(i / (points.length - 1)) * 600},${85 - ((p.p - min) / (max - min || 1)) * 70}`,
    )
    .join(" ");
  return (
    <svg
      className="spark"
      viewBox="0 0 600 100"
      preserveAspectRatio="none"
      role="img"
      aria-label="Preços de fechamento dos últimos 60 candles de um minuto"
    >
      <line x1="0" y1="90" x2="600" y2="90" />
      <polyline points={coords} />
    </svg>
  );
}
function App() {
  const [state, setState] = useState<State | null>(null),
    [connected, setConnected] = useState(false),
    [lastMessage, setLastMessage] = useState(0),
    [now, setNow] = useState(Date.now()),
    [tab, setTab] = useState("scanner"),
    [selected, setSelected] = useState("BTCUSDT"),
    [group, setGroup] = useState("byAsset");
  useEffect(() => {
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
          const data = JSON.parse(e.data);
          setState(data);
          setLastMessage(Date.now());
        } catch {
          setConnected(false);
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!stop) retry = setTimeout(open, 2000);
      };
      ws.onerror = () => ws?.close();
    };
    open();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop = true;
      clearInterval(tick);
      clearTimeout(retry);
      ws?.close();
    };
  }, []);
  const fresh = connected && now - lastMessage < 6000,
    asset =
      state?.assets.find((x) => x.symbol === selected) || state?.assets[0],
    m = state?.metrics,
    lab = state?.strategies,
    grouped = m
      ? (m as unknown as Record<string, Record<string, Metric>>)[group]
      : {};
  const download = () => {
    if (!state) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(state.signals, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "paper-signals.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="app">
      <aside>
        <a className="brand" href="#" aria-label="Yosh Market Intelligence">
          <span className="brand-icon">
            <Activity size={24} />
          </span>
          <span>
            YOSH<span className="brand-sub">MARKET INTELLIGENCE</span>
          </span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Principal">
          {[
            { id: "scanner", label: "Scanner ao vivo", icon: Radio },
            { id: "paper", label: "Paper trading", icon: Layers3 },
            { id: "news", label: "News intelligence", icon: Newspaper },
            { id: "lab", label: "Estratégias", icon: Target },
            { id: "metrics", label: "Desempenho", icon: BarChart3 },
            { id: "system", label: "Dados e modelos", icon: Database },
          ].map((x) => (
            <button
              key={x.id}
              aria-current={tab === x.id ? "page" : undefined}
              className={tab === x.id ? "active" : ""}
              onClick={() => setTab(x.id)}
            >
              <x.icon size={18} />
              {x.label}
              {tab === x.id && <ChevronRight size={15} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={22} />
          <strong>Integridade primeiro</strong>
          <p>Dados reais. Fontes identificadas. Nenhuma execução de ordens.</p>
          <span className="tag">PAPER ONLY</span>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />{" "}
            <span>
              {tab === "scanner"
                ? "Market scanner"
                : tab === "paper"
                  ? "Paper trading"
                  : tab === "news"
                    ? "News intelligence"
                    : tab === "metrics"
                      ? "Desempenho"
                      : tab === "lab"
                        ? "Laboratório de estratégias"
                        : "Dados e modelos"}
            </span>
          </div>
          <div className="header-status">
            <span className={"status-dot " + (fresh ? "ok" : "bad")} />
            {fresh ? "Painel conectado" : "Painel desconectado"}
            <span className="clock">{time(now)}</span>
          </div>
        </header>
        <div className="content">
          <div className="page-title">
            <div>
              <div className="eyebrow">INTELLIGENCE TERMINAL / 01</div>
              <h1>
                {tab === "scanner"
                  ? "Uma visão clara do mercado."
                  : tab === "paper"
                    ? "Registro de paper trading."
                    : tab === "news"
                      ? "Contexto além do gráfico."
                      : tab === "metrics"
                        ? "Evidência, antes de confiança."
                        : tab === "lab"
                          ? "Só opera o que venceu o teste."
                          : "A origem de cada decisão."}
              </h1>
              <p>
                {tab === "scanner"
                  ? "Análise contínua de criptoativos em horizontes de 5, 10 e 15 minutos."
                  : tab === "paper"
                    ? "Previsão, execução observada e resultado registrados separadamente."
                    : tab === "news"
                      ? "Classificação de eventos e reação do mercado com horários auditáveis."
                      : tab === "metrics"
                        ? "Resultados medidos, sem metas artificiais de acerto."
                        : tab === "lab"
                          ? "Estratégias testadas em histórico real da Binance, com assertividade medida fora da amostra."
                          : "Acompanhe fontes, saúde do feed e validação dos modelos."}
              </p>
            </div>
            <span className="mode">
              <ShieldCheck size={16} />
              {state?.sniper ? "SNIPER · PAPER" : "PAPER TRADING"}
            </span>
          </div>
          {!fresh && (
            <div className="banner danger" role="alert">
              <WifiOff size={18} />
              <span>
                <strong>ANÁLISE INDISPONÍVEL</strong> · A conexão com o painel
                está interrompida. Informações anteriores não são sinais
                válidos.
              </span>
            </div>
          )}
          <div className="overview">
            <div>
              <span>Ativos monitorados</span>
              <strong>
                {state ? state.assets.length : "—"}
                <small> / USDT</small>
              </strong>
            </div>
            <div>
              <span>Sinais registrados</span>
              <strong>
                {number(m?.total)}
                <small>dados persistidos</small>
              </strong>
            </div>
            <div>
              <span>Taxa de acerto paper</span>
              <strong>
                {percent(m?.winRate)}
                <small>
                  {m?.count ? `${m.count} resultados` : "Aguardando resultados"}
                </small>
              </strong>
            </div>
            <div>
              <span>Estratégias aprovadas</span>
              <strong>
                {state?.strategies ? state.strategies.approved : "—"}
                <small>
                  {state?.strategies
                    ? `de ${state.strategies.tested} testadas no histórico`
                    : "aguardando backtest"}
                </small>
              </strong>
            </div>
          </div>
          {tab === "scanner" && (
            <>
              <div className="section-head">
                <h2>
                  <Radio size={18} />
                  Visão de mercado
                </h2>
                <span>Binance Spot · WebSocket</span>
              </div>
              <div className="asset-tabs">
                {(state?.assets || []).map((a) => (
                  <button
                    key={a.symbol}
                    aria-pressed={asset?.symbol === a.symbol}
                    onClick={() => setSelected(a.symbol)}
                    className={asset?.symbol === a.symbol ? "selected" : ""}
                  >
                    <span className={"coin " + a.symbol.slice(0, 3)}>
                      {a.symbol.slice(0, 1)}
                    </span>
                    <span className="asset-name">
                      {a.symbol.replace("USDT", "")}
                      <small>/ USDT</small>
                    </span>
                    <span className="asset-price">
                      {money(a.price)}
                      <small className={(a.change || 0) >= 0 ? "up" : "down"}>
                        {a.change == null
                          ? "Sem histórico"
                          : (a.change >= 0 ? "+" : "") + percent(a.change)}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
              {asset ? (
                <>
                  <section className="market-panel">
                    <div className="market-top">
                      <div>
                        <span className="eyebrow">
                          {asset.symbol.replace("USDT", " / USDT")}
                        </span>
                        <div className="big-price">{money(asset.price)}</div>
                        <span
                          className={(asset.change || 0) >= 0 ? "up" : "down"}
                        >
                          {percent(asset.change)}{" "}
                          <small className="muted">
                            · últimos 60 candles 1m
                          </small>
                        </span>
                      </div>
                      <div className="market-facts">
                        <div>
                          <span>Feed de mercado</span>
                          <strong
                            className={
                              asset.feed === "CONECTADO" && fresh
                                ? "up"
                                : "warn"
                            }
                          >
                            {fresh ? asset.feed : "DESCONECTADO"}
                          </strong>
                        </div>
                        <div>
                          <span>ATR / preço</span>
                          <strong>
                            {percent(Number(asset.features?.atrPct) || null)}
                          </strong>
                        </div>
                        <div>
                          <span>Volume relativo</span>
                          <strong>
                            {asset.features
                              ? number(Number(asset.features.relativeVolume)) +
                                " ×"
                              : "—"}
                          </strong>
                        </div>
                        <div>
                          <span>Spread</span>
                          <strong>
                            {asset.features
                              ? number(Number(asset.features.spreadBps)) +
                                " bps"
                              : "—"}
                          </strong>
                        </div>
                      </div>
                    </div>
                    <Spark points={asset.chart} />
                    <div className="chart-footer">
                      <span>
                        Fechamentos observados · 1m é apenas insumo de análise
                      </span>
                      <span>
                        Último trade{" "}
                        {asset.eventTime ? time(asset.eventTime) : "—"}
                      </span>
                    </div>
                  </section>
                  {asset.reasons.length > 0 && (
                    <div className="banner">
                      <Clock3 size={18} />
                      <span>{asset.reasons.join(" · ")}</span>
                    </div>
                  )}
                  <div className="section-head">
                    <h2>
                      <Target size={18} />
                      Horizontes de decisão
                    </h2>
                    <span>
                      Estratégias validadas e modelos · validade de 30 segundos
                    </span>
                  </div>
                  <div className="forecasts">
                    {asset.forecasts.map((f) => {
                      const valid =
                          fresh &&
                          (!f.signal ||
                            (f.signal.status === "PENDING" &&
                              f.signal.expires > state!.time)),
                        label = !fresh
                          ? "ANÁLISE INDISPONÍVEL"
                          : !valid
                            ? "SEM ENTRADA"
                            : f.state;
                      return (
                        <article className="forecast" key={f.horizon}>
                          <div className="forecast-head">
                            <span>
                              {f.horizon}
                              <small> MIN</small>
                            </span>
                            <Clock3 size={18} />
                          </div>
                          <h3
                            className={
                              label === "COMPRA"
                                ? "up"
                                : label === "VENDA"
                                  ? "down"
                                  : "muted"
                            }
                          >
                            {label === "COMPRA" ? (
                              <ArrowUpRight />
                            ) : label === "VENDA" ? (
                              <ArrowDownRight />
                            ) : (
                              <span className="neutral-icon">—</span>
                            )}
                            {label}
                          </h3>
                          <div className="probability">
                            <span>
                              {f.reason.startsWith("ESTRATÉGIA")
                                ? "Acerto medido no backtest"
                                : "Probabilidade calibrada"}
                            </span>
                            <strong>
                              {fresh && f.probability !== null
                                ? percent(f.probability)
                                : "—"}
                            </strong>
                          </div>
                          <p className="reason">{f.reason}</p>
                          {f.signal && (
                            <div className="entry">
                              <span>Faixa da última previsão</span>
                              <strong>
                                {money(f.signal.entryLow)} –{" "}
                                {money(f.signal.entryHigh)}
                              </strong>
                              <small>
                                {valid
                                  ? `Validade: ${Math.max(0, Math.ceil((f.signal.expires - state!.time) / 1000))}s`
                                  : `Status: ${f.signal.status}`}
                              </small>
                            </div>
                          )}
                          <div className="factor-list">
                            <span>FATORES FAVORÁVEIS</span>
                            {f.favorable.length ? (
                              f.favorable.map((x) => (
                                <p key={x}>
                                  <Check size={14} />
                                  {names[x] || x}
                                </p>
                              ))
                            ) : (
                              <p className="muted">
                                Aguardando evidência validada
                              </p>
                            )}
                            <span>FATORES CONTRÁRIOS</span>
                            {f.contrary.length ? (
                              f.contrary.map((x) => (
                                <p key={x}>
                                  <X size={14} />
                                  {names[x] || x}
                                </p>
                              ))
                            ) : (
                              <p className="muted">
                                {f.probability === null
                                  ? "Análise ainda indisponível"
                                  : "Nenhum grupo contrário nesta avaliação"}
                              </p>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  <section className="evidence">
                    <h2>Leitura dos componentes</h2>
                    <div>
                      {Object.entries(names).map(([key, label]) => (
                        <div key={key}>
                          <span>{label}</span>
                          <strong
                            className={
                              asset.groups?.[key] === 1
                                ? "up"
                                : asset.groups?.[key] === -1
                                  ? "down"
                                  : "muted"
                            }
                          >
                            {!fresh || !asset.groups
                              ? "INDISPONÍVEL"
                              : asset.groups[key] === 1
                                ? "COMPRADOR"
                                : asset.groups[key] === -1
                                  ? "VENDEDOR"
                                  : "NEUTRO"}
                          </strong>
                        </div>
                      ))}
                    </div>
                    <p className="small muted">
                      Componentes são evidências heurísticas, não
                      probabilidades. Livro parcial limitado aos 20 melhores
                      níveis.
                    </p>
                  </section>
                </>
              ) : (
                <div className="empty">
                  <Database />
                  <h2>Aguardando o coletor</h2>
                  <p>
                    Os pares aparecem quando o backend estabelece a conexão.
                    Nenhum preço de demonstração será exibido.
                  </p>
                </div>
              )}
            </>
          )}
          {tab === "paper" && (
            <section className="panel">
              <div className="section-head">
                <h2>Livro de sinais</h2>
                <button
                  className="secondary"
                  onClick={download}
                  disabled={!state}
                >
                  <Download size={16} />
                  Exportar JSON
                </button>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Horário</th>
                      <th>Ativo</th>
                      <th>Horizonte</th>
                      <th>Direção</th>
                      <th>Entrada paper</th>
                      <th>Saída</th>
                      <th>Retorno</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state?.signals.map((s) => (
                      <tr key={s.id}>
                        <td title={s.id}>{time(s.t)}</td>
                        <td>{s.symbol}</td>
                        <td>{s.horizon} min</td>
                        <td
                          className={s.direction === "COMPRA" ? "up" : "down"}
                        >
                          {s.direction}
                        </td>
                        <td>{money(s.entry)}</td>
                        <td>{money(s.exit)}</td>
                        <td>{percent(s.return)}</td>
                        <td>
                          <span className="tag">{s.result || s.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!state?.signals.length && (
                <Empty
                  title="Nenhum sinal registrado"
                  text="O coletor registra observações enquanto aguarda modelos calibrados e confluência suficiente."
                />
              )}
              <p className="muted small">
                Compra entra no ask e sai no bid; venda entra no bid e sai no
                ask. Neutralidade usa o threshold configurado. Dados ausentes
                ficam como NO_DATA.
              </p>
            </section>
          )}
          {tab === "news" && (
            <section className="panel">
              <div className="section-head">
                <h2>
                  <Newspaper size={18} />
                  Eventos monitorados
                </h2>
                <span className="tag">
                  {state?.newsStatus || "AGUARDANDO BACKEND"}
                </span>
              </div>
              <div className="banner">
                <ShieldCheck size={18} />
                Confiança da IA classifica o texto. Não é probabilidade de o
                mercado subir ou cair.
              </div>
              {state?.news.length ? (
                state.news.map((n) => (
                  <article className="news-card" key={n.id}>
                    <div className="eyebrow">
                      {n.source} · {time(n.publishedAt)}
                    </div>
                    <a href={n.url} target="_blank" rel="noreferrer">
                      <h3>
                        {n.title}
                        <ExternalLink size={15} />
                      </h3>
                    </a>
                    <p>
                      {n.classification?.summary ||
                        "CLASSIFICAÇÃO INDISPONÍVEL"}
                    </p>
                    {n.classification && (
                      <>
                        <div className="news-tags">
                          <span className="tag">
                            {n.classification.assets.join(", ")}
                          </span>
                          <span className="tag">
                            {n.classification.sentiment}
                          </span>
                          <span>
                            Impacto estimado: {n.classification.impact_score}/10
                          </span>
                          <span>
                            Confiança da classificação:{" "}
                            {percent(n.classification.confidence)}
                          </span>
                        </div>
                        <details>
                          <summary>Fundamentação e reação observada</summary>
                          <p>{n.classification.reasoning_summary}</p>
                          {n.reactions.map((r) => (
                            <p key={r.symbol + r.horizon}>
                              {r.symbol} · {r.horizon} min ·{" "}
                              {r.status === "MEASURED"
                                ? percent(r.return)
                                : "SEM DADOS"}
                            </p>
                          ))}
                        </details>
                      </>
                    )}
                  </article>
                ))
              ) : (
                <Empty
                  title="Fonte de notícias não configurada ou sem eventos"
                  text="Configure o feed JSON e o provedor de IA em .env. O modo SNIPER permanece bloqueado sem cobertura de notícias."
                />
              )}
            </section>
          )}
          {tab === "lab" && (
            <>
              <div className="overview">
                <div>
                  <span>Situação</span>
                  <strong>
                    <small>{lab?.status || "AGUARDANDO BACKEND"}</small>
                  </strong>
                </div>
                <div>
                  <span>Histórico testado</span>
                  <strong>
                    <small>
                      {lab?.historyFrom
                        ? `${new Date(lab.historyFrom).toLocaleDateString("pt-BR")} – ${new Date(lab.historyTo!).toLocaleDateString("pt-BR")}`
                        : "—"}
                    </small>
                  </strong>
                </div>
                <div>
                  <span>Aprovadas / testadas</span>
                  <strong>
                    {lab ? `${lab.approved} / ${lab.tested}` : "—"}
                  </strong>
                </div>
                <div>
                  <span>Break-even (payout)</span>
                  <strong>{percent(lab?.breakEven)}</strong>
                </div>
              </div>
              <div className="banner">
                Cada família de estratégia tem os parâmetros escolhidos nos
                primeiros 60% do histórico e é julgada uma única vez nos 40%
                finais, que ela nunca viu. Só é aprovada com pelo menos{" "}
                {lab?.minTrades ?? 100} operações fora da amostra, limite
                inferior de confiança de 95% acima do break-even e as duas
                metades do teste acima do break-even. Resultado passado não
                garante resultado futuro.
              </div>
              {lab?.error && <p className="down">{lab.error}</p>}
              <section className="panel">
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Ativo</th>
                        <th>Horizonte</th>
                        <th>Estratégia</th>
                        <th>Operações (teste)</th>
                        <th>Acerto (teste)</th>
                        <th>Mínimo com 95% de confiança</th>
                        <th>Acerto (seleção)</th>
                        <th>Veredito</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(lab?.evaluations || []).map((e) => (
                        <tr key={`${e.symbol}:${e.horizon}:${e.id}`}>
                          <td>{e.symbol.replace("USDT", "")}</td>
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
                            {percent(e.outOfSample.winRate)}
                          </td>
                          <td>{percent(e.outOfSample.lower)}</td>
                          <td>{percent(e.inSample.winRate)}</td>
                          <td className={e.approved ? "up" : "muted"}>
                            {e.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!lab?.evaluations.length && (
                  <Empty
                    title="Backtest em andamento"
                    text="O servidor baixa o histórico real de 1 minuto da Binance e testa todas as estratégias. Isso leva poucos minutos após iniciar."
                  />
                )}
              </section>
            </>
          )}
          {tab === "metrics" && (
            <>
              <div className="overview">
                <div>
                  <span>Wins / Losses / Neutros</span>
                  <strong>
                    {m ? `${m.wins} / ${m.losses} / ${m.neutrals}` : "—"}
                  </strong>
                </div>
                <div>
                  <span>Maior sequência de perdas</span>
                  <strong>{number(m?.maxLossStreak)}</strong>
                </div>
                <div>
                  <span>Payout configurado</span>
                  <strong>{percent(m?.payout)}</strong>
                </div>
                <div>
                  <span>Break-even teórico</span>
                  <strong>{percent(m?.breakEven)}</strong>
                </div>
              </div>
              <div className="banner">
                Break-even = 1 / (1 + payout). Neutros considerados
                reembolsados, sem taxas. Isso não garante lucro futuro nem
                reproduz a liquidação de uma corretora.
              </div>
              <section className="panel">
                <div className="section-head">
                  <h2>Desempenho segmentado</h2>
                  <label>
                    Agrupar por{" "}
                    <select
                      value={group}
                      onChange={(e) => setGroup(e.target.value)}
                    >
                      <option value="byAsset">Ativo</option>
                      <option value="byHorizon">Horizonte</option>
                      <option value="byHour">Horário (São Paulo)</option>
                      <option value="byStrategy">Modelo / estratégia</option>
                      <option value="byNews">Notícias</option>
                    </select>
                  </label>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Grupo</th>
                        <th>Resultados</th>
                        <th>Wins</th>
                        <th>Losses</th>
                        <th>Neutros</th>
                        <th>Acerto</th>
                        <th>Sequência de perdas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(grouped || {}).map(([key, v]) => (
                        <tr key={key}>
                          <td>{key}</td>
                          <td>{v.count}</td>
                          <td>{v.wins}</td>
                          <td>{v.losses}</td>
                          <td>{v.neutrals}</td>
                          <td>{percent(v.winRate)}</td>
                          <td>{v.maxLossStreak}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!m?.count && (
                  <Empty
                    title="Ainda não há resultados medidos"
                    text="As estatísticas serão preenchidas após o vencimento de sinais reais em paper trading."
                  />
                )}
              </section>
              <section className="panel">
                <h2>Calibração prospectiva das previsões</h2>
                <p className="muted">
                  Probabilidade prevista comparada ao rótulo de retorno
                  observado. Não usa o resultado da execução paper.
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Faixa</th>
                        <th>Amostras</th>
                        <th>Probabilidade média</th>
                        <th>Frequência observada</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m?.calibration
                        .filter((b) => b.count > 0)
                        .map((b) => (
                          <tr key={b.from}>
                            <td>
                              {percent(b.from)} – {percent(b.to)}
                            </td>
                            <td>{b.count}</td>
                            <td>{percent(b.predicted)}</td>
                            <td>{percent(b.observed)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
          {tab === "system" && (
            <>
              <section className="panel">
                <h2>Saúde e proveniência</h2>
                <div className="system-grid">
                  <div>
                    <span>Banco de dados</span>
                    <strong>{state?.database || "AGUARDANDO BACKEND"}</strong>
                  </div>
                  <div>
                    <span>Feed / mercado</span>
                    <strong>Binance · spot público</strong>
                  </div>
                  <div>
                    <span>News Intelligence</span>
                    <strong>{state?.newsStatus || "AGUARDANDO BACKEND"}</strong>
                  </div>
                  <div>
                    <span>Deduplicação semântica</span>
                    <strong>
                      {state?.newsCapabilities.semanticDedup ||
                        "NÃO CONFIGURADA"}
                    </strong>
                  </div>
                  <div>
                    <span>Observações coletadas</span>
                    <strong>
                      {m
                        ? m.observations.reduce((s, x) => s + x.count, 0)
                        : "—"}
                    </strong>
                  </div>
                </div>
                <div className="banner">
                  Não há operação automática. APIs externas usam configuração
                  explícita. Sem modelo compatível, a decisão permanece
                  indisponível.
                </div>
              </section>
              <section className="panel">
                <h2>Modelos carregados</h2>
                {state?.models.length ? (
                  state.models.map((model) => (
                    <div className="model-row" key={model.id}>
                      <strong>
                        {model.symbol} · {model.horizon} min
                      </strong>
                      <span>
                        {model.sampleCount} amostras · {model.testCount} teste
                      </span>
                      <span>
                        Brier {number(model.metrics.brier)} · ECE{" "}
                        {number(model.metrics.ece)}
                      </span>
                      <small>
                        Teste até{" "}
                        {new Date(model.testEnd).toLocaleString("pt-BR")}
                      </small>
                    </div>
                  ))
                ) : (
                  <Empty
                    title="DADOS INSUFICIENTES PARA CONFIANÇA CALIBRADA"
                    text="Colete observações, exporte os dados, rode a validação temporal e revise os modelos antes de carregá-los."
                  />
                )}
                {Object.entries(state?.modelErrors || {}).map(([k, v]) => (
                  <p key={k} className="down">
                    {k}: {v}
                  </p>
                ))}
              </section>
              <section className="panel">
                <h2>Indicadores disponíveis</h2>
                <div className="system-grid">
                  {Object.entries(asset?.indicators || {}).map(([k, v]) => (
                    <div key={k}>
                      <span>{k}</span>
                      <strong>{number(v)}</strong>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
          <footer>
            <span>
              <ShieldCheck size={14} />
              Observação real. Decisão auditável.
            </span>
            <span>YOSH / RESEARCH SYSTEM · v1.0</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <Activity size={28} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
