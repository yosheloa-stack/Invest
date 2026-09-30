import { useEffect, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Minus,
  Radar as RadarIcon,
} from "lucide-react";
import { CoinIcon } from "./Icons";
import { beep } from "./SignalDock";
import { api, countdown, price, ticker } from "./format";
import { speak, spokenAsset } from "./voice";
import type { MoneyPlan, MoneyRules, PatternHit, RadarItem } from "./types";
const Bias = ({ b }: { b: number }) =>
  b > 0 ? (
    <ArrowUpRight size={14} className="up" />
  ) : b < 0 ? (
    <ArrowDownRight size={14} className="down" />
  ) : (
    <Minus size={14} className="muted" />
  );
const soundOn = () => {
  try {
    return localStorage.getItem("yosh-robot-sound") !== "0";
  } catch {
    return true;
  }
};
// One radar poll for the whole app: the watcher alerts on every screen, the panel just shows it.
let latest: RadarItem[] | null = null;
const listeners = new Set<(x: RadarItem[]) => void>();
export function RadarWatcher() {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () =>
      api<{ items: RadarItem[] }>("/api/radar")
        .then((x) => {
          if (stop) return;
          latest = x.items;
          listeners.forEach((f) => f(x.items));
          // Beep and speak once for each new entry or "quase entrando" (the robot's own
          // entries are announced by the robot alert).
          const strong = x.items.filter((i) => i.score >= 2.5),
            key = (i: RadarItem) => `${i.symbol}|${i.title}`;
          if (seen.current) {
            const fresh = strong.filter((i) => !seen.current!.has(key(i)));
            if (fresh.length && soundOn()) beep(fresh[0].bias >= 0);
            for (const i of fresh.slice(0, 2))
              if (i.score >= 3 && i.score < 4)
                speak(
                  `Atenção, quase entrando: ${i.bias > 0 ? "compra" : "venda"} no ${spokenAsset(i.symbol)}`,
                );
          }
          seen.current = new Set(strong.map(key));
        })
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 10000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  return null;
}
// "Quase entrando": every asset where an entry, a pattern breakout or a strong candle is close.
export function RadarPanel({
  onSelect,
  now,
}: {
  onSelect: (symbol: string) => void;
  now: number;
}) {
  const [items, setItems] = useState<RadarItem[] | null>(latest);
  useEffect(() => {
    listeners.add(setItems);
    return () => void listeners.delete(setItems);
  }, []);
  const nextM5 = 300000 - (now % 300000);
  return (
    <section className="radar">
      <div className="radar-head">
        <RadarIcon size={16} />
        <b>Radar: quase entrando</b>
        <span className="muted">Próxima vela M5 em {countdown(nextM5)}</span>
      </div>
      {!items ? (
        <p className="muted pad">Carregando o radar…</p>
      ) : !items.length ? (
        <p className="muted pad">
          Nada perto de acontecer agora. O radar olha todos os ativos a cada
          vela fechada.
        </p>
      ) : (
        items.map((i, k) => (
          <button
            key={`${i.symbol}-${i.title}-${k}`}
            className={`radar-item s${Math.floor(i.score)}`}
            onClick={() => onSelect(i.symbol)}
          >
            <CoinIcon symbol={i.symbol} size={20} />
            <span className="radar-text">
              <b>
                {ticker(i.symbol)} <Bias b={i.bias} /> {i.title}
              </b>
              <small>{i.detail}</small>
            </span>
          </button>
        ))
      )}
    </section>
  );
}
function PatternRow({ p }: { p: PatternHit }) {
  return (
    <div className={`pattern ${p.bias > 0 ? "buy" : p.bias < 0 ? "sell" : ""}`}>
      <div className="pattern-head">
        <Bias b={p.bias} />
        <b>{p.name}</b>
        <span className="tag">
          {p.status === "rompeu"
            ? "Rompeu"
            : p.status === "formando"
              ? "Formando"
              : "Na última vela M5"}
        </span>
      </div>
      <p>{p.meaning}</p>
      <p className="pattern-action">{p.action}</p>
      {(p.level != null || p.target != null || p.invalid != null) &&
        p.kind === "grafico" && (
          <div className="pattern-levels">
            {p.level != null && (
              <span>
                Rompe em <b>{price(p.level)}</b>
              </span>
            )}
            {p.target != null && (
              <span>
                Alvo <b>{price(p.target)}</b>
              </span>
            )}
            {p.invalid != null && (
              <span>
                Invalida <b>{price(p.invalid)}</b>
              </span>
            )}
          </div>
        )}
    </div>
  );
}
// Patterns on the chart's asset, with what they mean and where they confirm.
export function PatternPanel({
  patterns,
}: {
  patterns?: { candles: PatternHit[]; charts: PatternHit[] };
}) {
  if (!patterns) return null;
  const all = [...patterns.charts, ...patterns.candles];
  return (
    <section className="patterns">
      <h3>Padrões agora (M5)</h3>
      {all.length ? (
        all.map((p) => <PatternRow key={`${p.kind}-${p.id}`} p={p} />)
      ) : (
        <p className="muted">
          Nenhum padrão de candle ou de gráfico claro neste ativo agora.
        </p>
      )}
    </section>
  );
}
// Gestão de banca: fixed or percentage entry, Soros levels and daily stops.
export function MoneySettings({
  money,
  plan,
  admin,
  onSave,
}: {
  money?: MoneyRules;
  plan?: MoneyPlan;
  admin: boolean;
  onSave: (m: MoneyRules) => Promise<void>;
}) {
  const [draft, setDraft] = useState<MoneyRules | undefined>(money),
    [saving, setSaving] = useState(false);
  useEffect(() => setDraft(money), [JSON.stringify(money)]);
  if (!draft) return null;
  const set = (patch: Partial<MoneyRules>) => setDraft({ ...draft, ...patch });
  const dirty = JSON.stringify(draft) !== JSON.stringify(money);
  const num = (
    label: string,
    key: "value" | "stopWin" | "stopLoss",
    suffix: string,
  ) => (
    <label className="money-field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={key === "value" && draft.mode === "fixo" ? 1 : 0.5}
        value={draft[key]}
        disabled={!admin || saving}
        onChange={(e) => set({ [key]: Number(e.target.value) || 0 })}
      />
      <small>{suffix}</small>
    </label>
  );
  return (
    <div className="rb-setting money">
      <span>Gestão de banca</span>
      <div className="rb-exp" role="group" aria-label="Tipo de entrada">
        {(["fixo", "percent"] as const).map((m) => (
          <button
            key={m}
            className={draft.mode === m ? "on" : ""}
            aria-pressed={draft.mode === m}
            disabled={!admin || saving}
            onClick={() =>
              draft.mode !== m &&
              set({ mode: m, value: m === "percent" ? 2 : 10 })
            }
          >
            {m === "fixo" ? "Valor fixo" : "% da banca"}
          </button>
        ))}
      </div>
      <div className="money-grid">
        {num("Entrada", "value", draft.mode === "fixo" ? "R$" : "% da banca")}
        {num("Stop win do dia", "stopWin", "% (0 = sem)")}
        {num("Stop loss do dia", "stopLoss", "% (0 = sem)")}
      </div>
      <span>Soros</span>
      <div className="rb-exp" role="group" aria-label="Níveis de Soros">
        {[0, 1, 2, 3].map((n) => (
          <button
            key={n}
            className={draft.soros === n ? "on" : ""}
            aria-pressed={draft.soros === n}
            disabled={!admin || saving}
            onClick={() => set({ soros: n })}
          >
            {n ? `Nível ${n}` : "Sem"}
          </button>
        ))}
      </div>
      <small className="muted">
        Soros: depois de um ganho, a próxima entrada leva o lucro junto, até o
        nível escolhido; perdeu, volta ao valor base. Martingale não entra aqui:
        dobrar depois de perder é o jeito mais rápido de quebrar a banca.
      </small>
      {plan && (
        <p className="money-plan">
          Próxima entrada: <b>{plan.stake.toFixed(2).replace(".", ",")}</b>
          {plan.sorosLevel ? ` (Soros nível ${plan.sorosLevel})` : ""} · hoje{" "}
          <b className={plan.today >= 0 ? "up" : "down"}>
            {plan.today >= 0 ? "+" : ""}
            {plan.today.toFixed(2).replace(".", ",")}
          </b>
          {plan.stop ? ` · ${plan.stop}` : ""}
        </p>
      )}
      {admin && dirty && (
        <button
          className="rb-toggle"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await onSave(draft);
            setSaving(false);
          }}
        >
          Salvar gestão
        </button>
      )}
    </div>
  );
}
