import type { Asset, Metrics, Signal } from "./types";
import { countdown, pct, price } from "./format";
import { evidenceLabel, resultLabel } from "./signal-events";
export default function SignalActivity({
  asset,
  signals,
  metrics,
  now,
  fresh,
}: {
  asset: Asset;
  signals: Signal[];
  metrics: Metrics | null;
  now: number;
  fresh: boolean;
}) {
  const rows = signals
    .filter((s) => s.symbol === asset.symbol)
    .sort((a, b) => b.t - a.t)
    .slice(0, 6);
  const measured = metrics?.byAsset[asset.symbol];
  const age =
    asset.eventTime == null ? null : Math.max(0, now - asset.eventTime);
  return (
    <section className="signal-activity" aria-label="Entradas e resultados">
      <header>
        <div>
          <strong>Entradas e resultados</strong>
          <span>Paper · Binance Spot</span>
        </div>
        <span className={!fresh || age == null || age > 5000 ? "down" : "up"}>
          {!fresh
            ? "Desconectado"
            : age == null
              ? "Aguardando cotação"
              : `Idade da cotação: ${(age / 1000).toFixed(1)}s`}
        </span>
      </header>
      <div className="result-summary">
        <span>
          <b>{measured?.wins ?? (metrics ? 0 : "—")}</b> GREEN
        </span>
        <span>
          <b>{measured?.losses ?? (metrics ? 0 : "—")}</b> RED
        </span>
        <span>
          <b>{measured?.neutrals ?? (metrics ? 0 : "—")}</b> Neutros
        </span>
        <span>
          <b>{pct(measured?.winRate)}</b> Acerto paper ·{" "}
          {metrics ? (measured?.wins ?? 0) + (measured?.losses ?? 0) : "—"}{" "}
          resultados
        </span>
      </div>
      <div className="activity-rows">
        {!rows.length && (
          <p className="muted">
            Nenhuma entrada registrada para este par. Resultados reais do
            acompanhamento aparecerão aqui.
          </p>
        )}
        {rows.map((s) => (
          <div className="activity-row" key={s.id}>
            <div>
              <strong>
                {s.direction === "COMPRA" ? "Compra" : "Venda"} · {s.horizon}{" "}
                min
              </strong>
              <small>
                {evidenceLabel(s)}: {pct(s.probability)}
              </small>
            </div>
            <div>
              <span>
                {price(s.entry ?? s.analyzedPrice)}
                {s.exit != null ? ` → ${price(s.exit)}` : ""}
              </span>
              <small>{new Date(s.t).toLocaleTimeString("pt-BR")}</small>
            </div>
            <b
              className={
                s.result === "WIN"
                  ? "up"
                  : s.result === "LOSS"
                    ? "down"
                    : "muted"
              }
            >
              {s.status === "PENDING"
                ? !fresh
                  ? "Aguardando conexão"
                  : s.expires > now
                    ? `Válido ${countdown(s.expires - now)}`
                    : "Aguardando confirmação"
                : s.status === "FILLED"
                  ? !fresh
                    ? "Aguardando conexão"
                    : (s.due ?? 0) <= now
                      ? "Apurando resultado"
                      : `Em curso ${countdown(s.due! - now)}`
                  : resultLabel(s)}
            </b>
          </div>
        ))}
      </div>
      <p className="activity-note">
        Acerto no backtest é histórico; acerto paper mede este acompanhamento. A
        cotação pode diferir da sua corretora.
      </p>
    </section>
  );
}
