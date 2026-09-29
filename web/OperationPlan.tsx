import type { Asset, Signal } from "./types";
import { clock, countdown, pair, pct, price } from "./format";
import { evidenceLabel, resultLabel } from "./signal-events";
export default function OperationPlan({
  asset,
  signals,
  now,
  fresh,
}: {
  asset: Asset;
  signals: Signal[];
  now: number;
  fresh: boolean;
}) {
  const rows = signals
    .filter((s) => s.symbol === asset.symbol)
    .sort((a, b) => b.t - a.t);
  const active =
    rows.find((s) => s.status === "FILLED") ??
    rows.find((s) => s.status === "PENDING" && s.expires > now);
  const s = active ?? rows.find((s) => s.status === "SETTLED");
  const available = fresh && asset.feed === "CONECTADO";
  const reason = asset.forecasts.find((f) => f.reason)?.reason;
  return (
    <section className="operation-plan" aria-label="Plano da operação">
      <header>
        <strong>Plano da operação · {pair(asset.symbol)}</strong>
        <span>Simulação paper</span>
      </header>
      {!active && s && reason && (
        <p className="muted">Análise atual: {reason}</p>
      )}
      {!s ? (
        <p>
          {reason ||
            "Aguardando condições válidas. Ainda não há entrada para este ativo."}
        </p>
      ) : (
        <>
          <p className={s.direction === "COMPRA" ? "up" : "down"}>
            <strong>
              {s.direction} · {s.horizon} minutos
            </strong>{" "}
            ·{" "}
            {s.status === "SETTLED"
              ? `Último resultado: ${resultLabel(s)}`
              : !available
                ? "Dados indisponíveis — não iniciar nova entrada"
                : s.status === "FILLED"
                  ? "Entrada paper registrada"
                  : "Aguardando confirmação da cotação"}
          </p>
          <dl className="operation-grid">
            <div>
              <dt>Faixa para entrar</dt>
              <dd>
                {price(s.entryLow)} – {price(s.entryHigh)}
              </dd>
            </div>
            <div>
              <dt>Entrada registrada</dt>
              <dd>
                {s.entry == null
                  ? "Ainda não executada"
                  : `${price(s.entry)} · ${clock(s.entryAt!)}`}
              </dd>
            </div>
            <div>
              <dt>
                {s.status === "PENDING"
                  ? "Validade do sinal"
                  : "Saída por tempo"}
              </dt>
              <dd>
                {s.status === "PENDING"
                  ? `Até ${clock(s.expires)}`
                  : s.due
                    ? clock(s.due)
                    : "—"}
              </dd>
            </div>
            <div>
              <dt>
                {s.status === "SETTLED" ? "Preço de saída" : "Tempo restante"}
              </dt>
              <dd>
                {s.status === "SETTLED"
                  ? `${price(s.exit)} · ${s.exitAt ? clock(s.exitAt) : "—"}`
                  : !fresh
                    ? "Aguardando conexão"
                    : countdown(
                        (s.status === "PENDING" ? s.expires : (s.due ?? now)) -
                          now,
                      )}
              </dd>
            </div>
          </dl>
          <p>
            {s.favorable.length
              ? s.favorable.join(" · ")
              : "Consulte a análise da estratégia."}
          </p>
          <small>
            {evidenceLabel(s)}: {pct(s.probability)}.{" "}
            {s.status === "FILLED" && (s.due ?? 0) <= now
              ? "Prazo encerrado: apurando cotação."
              : `A saída é ${s.horizon} minutos após a entrada registrada, não após o aviso.`}{" "}
            O preço de saída só é conhecido no vencimento.
          </small>
        </>
      )}
    </section>
  );
}
