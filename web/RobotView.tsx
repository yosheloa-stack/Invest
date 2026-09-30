import { useEffect, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  Pause,
  Play,
  Sparkles,
} from "lucide-react";
import { CoinIcon } from "./Icons";
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
  State,
  User,
} from "./types";
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
function Analyze({
  state,
  selected,
}: {
  state: State | null;
  selected: string;
}) {
  const [symbol, setSymbol] = useState(selected),
    [busy, setBusy] = useState(false),
    [out, setOut] = useState<{
      read: MarketRead;
      text: string | null;
      source: "ia" | "regras";
      model: string | null;
      aiError: string | null;
    } | null>(null),
    [error, setError] = useState<string | null>(null);
  useEffect(() => setSymbol(selected), [selected]);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setOut(
        await api("/api/robot/analyze", {
          method: "POST",
          body: JSON.stringify({ symbol }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
      setOut(null);
    } finally {
      setBusy(false);
    }
  };
  const r = out?.read;
  return (
    <section className="panel rb-analyze">
      <div className="panel-head">
        <h2>Analisar agora</h2>
        <span className="muted">Leitura do último candle fechado</span>
      </div>
      <div className="rb-ask">
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          aria-label="Ativo"
        >
          {(state?.assets || []).map((a) => (
            <option key={a.symbol} value={a.symbol}>
              {pair(a.symbol)}
            </option>
          ))}
        </select>
        <button className="primary" onClick={run} disabled={busy}>
          <Sparkles size={15} />
          {busy ? "Analisando…" : "Analisar"}
        </button>
      </div>
      {error && <p className="notice bad-inline">{error}</p>}
      {r && (
        <div className="rb-result">
          <div className="rb-verdict">
            {r.pick ? (
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
          {out?.text ? (
            <div className="rb-text">
              <small>Análise da IA ({out.model})</small>
              {out.text
                .split("\n")
                .filter(Boolean)
                .map((l, i) => (
                  <p key={i}>{l}</p>
                ))}
            </div>
          ) : null}
          <ul className="rb-lines">
            {r.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          {out?.aiError && (
            <p className="muted">IA indisponível agora: {out.aiError}</p>
          )}
        </div>
      )}
    </section>
  );
}
export default function RobotView({
  state,
  user,
  selected,
  now,
  onOpen,
}: {
  state: State | null;
  user: User;
  selected: string;
  now: number;
  onOpen: (s: string) => void;
}) {
  const { data, error, reload } = useRobot(),
    brief: RobotBrief | null | undefined = state?.robot ?? data,
    s = brief?.stats,
    be = data?.breakEven ?? 0.5556;
  const toggle = async () => {
    if (!brief) return;
    await api("/api/robot/toggle", {
      method: "POST",
      body: JSON.stringify({ enabled: !brief.enabled }),
    }).catch(() => undefined);
    void reload();
  };
  return (
    <>
      <section className="rb-hero">
        <div className={`rb-avatar ${brief?.enabled ? "on" : ""}`}>
          <Bot size={30} strokeWidth={1.6} />
        </div>
        <div className="rb-hero-text">
          <h1>Robô IA</h1>
          <p>
            {brief
              ? sentence(brief.status)
              : error
                ? error
                : "Carregando o robô…"}
          </p>
          <div className="tags">
            <span>Simulação · nenhuma ordem é enviada à corretora</span>
            {data &&
              (data.ai.enabled ? (
                <span className="rb-ai on">
                  Claude ligado · {data.ai.model} · {data.ai.usedLastHour}/
                  {data.ai.maxPerHour} consultas na hora
                </span>
              ) : (
                <span className="rb-ai">
                  IA Claude desligada · o robô usa só as regras
                </span>
              ))}
          </div>
        </div>
        {user.role === "admin" && brief && (
          <button className="rb-toggle" onClick={toggle}>
            {brief.enabled ? <Pause size={15} /> : <Play size={15} />}
            {brief.enabled ? "Pausar robô" : "Ligar robô"}
          </button>
        )}
      </section>
      <section className="stats">
        <div>
          <span>Banca simulada</span>
          <strong className={(s?.profit ?? 0) >= 0 ? "up" : "down"}>
            {money(s?.balance)}
          </strong>
          <small>
            começou com {money(s?.bankroll)} · {money(data?.stake)} por entrada
          </small>
        </div>
        <div>
          <span>Acerto do robô</span>
          <strong
            className={s?.winRate == null ? "" : s.winRate > be ? "up" : "down"}
          >
            {pct(s?.winRate)}
          </strong>
          <small>precisa passar de {pct(be)}</small>
        </div>
        <div>
          <span>Operações</span>
          <strong>{s ? `${s.wins} / ${s.losses}` : "—"}</strong>
          <small>ganhos / perdas · {s?.ties ?? 0} empates</small>
        </div>
        <div>
          <span>Hoje</span>
          <strong className={(s?.todayProfit ?? 0) >= 0 ? "up" : "down"}>
            {money(s?.todayProfit, true)}
          </strong>
          <small>
            {s?.todayTrades ?? 0} operações ·{" "}
            {s?.streak
              ? Math.abs(s.streak) === 1
                ? `última: ${s.streak > 0 ? "vitória" : "derrota"}`
                : `${Math.abs(s.streak)} ${s.streak > 0 ? "vitórias" : "derrotas"} seguidas`
              : "sem sequência"}
          </small>
        </div>
      </section>
      <div className="rb-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Operações abertas</h2>
            <span className="muted">
              até {data?.maxOpen ?? 3} ao mesmo tempo, uma por ativo
            </span>
          </div>
          {brief?.open.length ? (
            <div className="rb-opens">
              {brief.open.map((t) => (
                <OpenTrade key={t.id} t={t} now={now} />
              ))}
            </div>
          ) : (
            <p className="muted">
              Nenhuma operação aberta. O robô entra sozinho quando um gatilho
              com histórico acima de {pct(data?.minScore ?? be)} dispara e o
              contexto do gráfico concorda.
            </p>
          )}
        </section>
        <Analyze state={state} selected={selected} />
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>O que o robô está vendo</h2>
          <span className="muted">Atualiza a cada candle de 1 minuto</span>
        </div>
        <div className="rb-reads">
          {(data?.reads || []).map((r) => (
            <button key={r.symbol} onClick={() => onOpen(r.symbol)}>
              <CoinIcon symbol={r.symbol} size={18} />
              <b>{ticker(r.symbol)}</b>
              <span className={`rb-trend ${r.trend.toLowerCase()}`}>
                {r.trend.toLowerCase()}
              </span>
              <span className="rb-read-why">{r.why}</span>
            </button>
          ))}
          {!data?.reads.length && (
            <p className="muted">
              Aguardando o próximo candle e o laboratório de estratégias.
            </p>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>Histórico do robô</h2>
          <span className="muted">
            Resultado pelo preço ao vivo no vencimento; payout{" "}
            {pct(data?.payout, 0)}
          </span>
        </div>
        <div className="table-scroll rb-table">
          <table>
            <thead>
              <tr>
                <th>Hora</th>
                <th>Ativo</th>
                <th>Direção</th>
                <th>Exp.</th>
                <th>Entrada → saída</th>
                <th>Resultado</th>
                <th>Por quê</th>
              </tr>
            </thead>
            <tbody>
              {(data?.trades || [])
                .filter((t) => t.status !== "ABERTA")
                .slice(0, 100)
                .map((t) => (
                  <tr key={t.id}>
                    <td>{clock(t.openedAt)}</td>
                    <td>{ticker(t.symbol)}</td>
                    <td>
                      <Dir d={t.direction} />
                    </td>
                    <td>{t.horizon} min</td>
                    <td>
                      {price(t.entry)} → {price(t.exit)}
                    </td>
                    <td>
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
                          {t.result === "WIN"
                            ? "Ganhou"
                            : t.result === "LOSS"
                              ? "Perdeu"
                              : "Empate"}{" "}
                          {money(t.profit, true)}
                        </b>
                      )}
                    </td>
                    <td className="rb-why-cell">
                      {t.note ?? t.strategy}
                      {t.ai ? ` · IA ${t.ai.confidence}%` : ""}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <ul className="rb-list">
          {(data?.trades || [])
            .filter((t) => t.status !== "ABERTA")
            .slice(0, 50)
            .map((t) => (
              <li key={t.id}>
                <CoinIcon symbol={t.symbol} size={20} />
                <div>
                  <p>
                    <b>{ticker(t.symbol)}</b> <Dir d={t.direction} />{" "}
                    <span className="muted">{t.horizon} min</span>
                  </p>
                  <small className="muted">
                    {clock(t.openedAt)} · {price(t.entry)} → {price(t.exit)}
                  </small>
                  <small className="muted">
                    {t.note ?? t.strategy}
                    {t.ai ? ` · IA ${t.ai.confidence}%` : ""}
                  </small>
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
        {!data?.trades.some((t) => t.status !== "ABERTA") && (
          <p className="muted pad">
            As operações aparecem aqui quando vencerem.
          </p>
        )}
      </section>
    </>
  );
}
// Compact card for the trading screen's right panel.
export function RobotMini({
  robot,
  symbol,
  now,
  onOpen,
}: {
  robot: RobotBrief | null | undefined;
  symbol: string;
  now: number;
  onOpen: () => void;
}) {
  if (!robot) return null;
  const t = robot.open.find((x) => x.symbol === symbol),
    s = robot.stats;
  return (
    <button className="rb-mini" onClick={onOpen}>
      <Bot size={16} />
      {t ? (
        <span>
          Robô em <b>{dirText(t.direction).toLowerCase()}</b> · {t.horizon} min
          · {countdown(t.due - now)}
        </span>
      ) : (
        <span>
          {robot.enabled ? "Robô procurando entrada" : "Robô pausado"}
          {s.trades ? ` · acerto ${pct(s.winRate)} em ${s.trades}` : ""}
        </span>
      )}
    </button>
  );
}
export type RobotRead = {
  enabled: boolean;
  ai: boolean;
  labReady: boolean;
  labStatus: string;
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
