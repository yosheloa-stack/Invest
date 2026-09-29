import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import type { Signal } from "./types";
import { api, clock, pair, price, pct } from "./format";
import { resultLabel } from "./signal-events";
export default function SignalHistory({ live }: { live: Signal[] }) {
  const [saved, setSaved] = useState<Signal[]>([]),
    [error, setError] = useState("");
  const [symbol, setSymbol] = useState(""),
    [horizon, setHorizon] = useState(""),
    [result, setResult] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const rows = await api<Signal[]>("/api/signals", {
          signal: controller.signal,
        });
        if (!Array.isArray(rows)) throw Error("Histórico indisponível");
        if (!controller.signal.aborted) {
          setSaved(rows);
          setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            "Não foi possível atualizar o histórico. Exibindo os registros disponíveis.",
          );
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);
  const all = useMemo(
    () =>
      [...new Map([...saved, ...live].map((s) => [s.id, s])).values()].sort(
        (a, b) => b.t - a.t,
      ),
    [saved, live],
  );
  const rows = all.filter(
    (s) =>
      (!symbol || s.symbol === symbol) &&
      (!horizon || s.horizon === +horizon) &&
      (!result ||
        (result === "OPEN"
          ? ["PENDING", "FILLED"].includes(s.status)
          : s.result === result)),
  );
  const wins = rows.filter((s) => s.result === "WIN").length,
    losses = rows.filter((s) => s.result === "LOSS").length;
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "sinais-filtrados.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const state = (s: Signal) =>
    s.status === "PENDING"
      ? "Aguardando entrada"
      : s.status === "FILLED"
        ? "Em andamento"
        : resultLabel(s);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Histórico de operações</h2>
        <button className="ghost" onClick={download} disabled={!rows.length}>
          <Download size={16} />
          Exportar seleção
        </button>
      </div>
      <div className="history-filters">
        <label>
          Ativo
          <select
            aria-label="Ativo"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
          >
            <option value="">Todos</option>
            {[...new Set(all.map((s) => s.symbol))].map((s) => (
              <option key={s} value={s}>
                {pair(s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Duração
          <select
            aria-label="Duração"
            value={horizon}
            onChange={(e) => setHorizon(e.target.value)}
          >
            <option value="">Todas</option>
            {[5, 10, 15].map((h) => (
              <option key={h} value={h}>
                {h} minutos
              </option>
            ))}
          </select>
        </label>
        <label>
          Resultado
          <select
            aria-label="Resultado"
            value={result}
            onChange={(e) => setResult(e.target.value)}
          >
            <option value="">Todos</option>
            <option value="WIN">GREEN</option>
            <option value="LOSS">RED</option>
            <option value="NEUTRO">Neutro</option>
            <option value="OPEN">Em aberto</option>
          </select>
        </label>
        <p>
          {rows.length} registros · {wins} GREEN · {losses} RED ·{" "}
          {pct(wins + losses ? wins / (wins + losses) : null)} acerto paper
        </p>
      </div>
      {error && (
        <p role="status" className="notice">
          {error}
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {[
                "Sinal emitido",
                "Ativo / direção",
                "Duração",
                "Entrada / horário",
                "Saída prevista",
                "Saída / horário",
                "Resultado",
                "Análise",
              ].map((t) => (
                <th key={t}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>
                  {new Date(s.t).toLocaleDateString("pt-BR")} {clock(s.t)}
                </td>
                <td>
                  {pair(s.symbol)} · {s.direction}
                </td>
                <td>{s.horizon} min</td>
                <td>
                  {price(s.entry)}
                  <br />
                  {s.entryAt ? clock(s.entryAt) : "Não executada"}
                </td>
                <td>
                  {s.due ? clock(s.due) : `Após entrada + ${s.horizon} min`}
                </td>
                <td>
                  {price(s.exit)}
                  <br />
                  {s.exitAt ? clock(s.exitAt) : "—"}
                </td>
                <td
                  className={
                    s.result === "WIN"
                      ? "up"
                      : s.result === "LOSS"
                        ? "down"
                        : ""
                  }
                >
                  {state(s)}
                </td>
                <td>
                  {s.favorable.join(" · ") || s.modelId}
                  {s.reason ? ` · ${s.reason}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p className="notice">Nenhuma operação corresponde aos filtros.</p>
      )}
      <p className="notice">
        Até 500 registros recentes persistidos, mais os recebidos ao vivo.
        Horários locais. Neutros e operações sem cotação não entram na taxa de
        acerto; o resultado é paper, não a execução na sua corretora.
      </p>
    </section>
  );
}
