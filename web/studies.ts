// The chart reuses the exact indicator math and strategy rules the server backtests,
// so what is drawn is what was measured.
import {
  buildSeries,
  catalog,
  type Series,
  type StrategySpec,
} from "../src/strategies";
import type { Candle } from "../src/types";
export { levelsAt } from "../src/strategies";
export type Study = "sr" | "ema" | "bb" | "vwap" | "vol" | "rsi";
export const STUDIES: { id: Study; label: string }[] = [
  { id: "sr", label: "Suporte e resistência" },
  { id: "ema", label: "EMA 9/21/50" },
  { id: "bb", label: "Bollinger" },
  { id: "vwap", label: "VWAP" },
  { id: "rsi", label: "RSI" },
  { id: "vol", label: "Volume" },
];
export const SPECS = new Map<string, StrategySpec>(
  catalog().map((s) => [s.id, s]),
);
export type Bar = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  buy: number;
};
export const series = (bars: Bar[]): Series =>
  buildSeries(
    bars.map((b) => ({ ...b, end: b.t + 59999, quote: 0 })) as Candle[],
  );
// Which indicators a strategy reads, so selecting it switches them on.
export function studiesFor(id: string | undefined): Study[] {
  const family = id?.split(":")[0],
    extra: Study[] =
      id?.endsWith(":tendencia") || id?.endsWith(":lateral") ? ["ema"] : [];
  return [...extra, ...byFamily(family)];
}
function byFamily(family: string | undefined): Study[] {
  switch (family) {
    case "sr-toque":
    case "sr-rompimento":
      return ["sr"];
    case "rsi":
      return ["rsi"];
    case "bollinger":
      return ["bb"];
    case "rsi-bollinger":
      return ["rsi", "bb"];
    case "pullback":
      return ["ema"];
    case "vwap":
      return ["vwap"];
    case "fluxo":
    case "exaustao":
      return ["vol"];
    default:
      return [];
  }
}
// Parameters the chart needs to draw the strategy's own levels.
export function params(id: string | undefined) {
  const [family, key = ""] = (id || "").split(":");
  if (family === "rsi") {
    const [n, lv] = key.split("-").map(Number);
    return { rsi: n === 7 ? 7 : 14, level: lv, bb: 2 };
  }
  if (family === "rsi-bollinger") return { rsi: 7, level: Number(key), bb: 2 };
  if (family === "bollinger") return { rsi: 14, level: 30, bb: Number(key) };
  return { rsi: 14, level: 30, bb: 2 };
}
export const FAMILY_TEXT: Record<string, string> = {
  rsi: "Olha o RSI: quando passa do limite, o preço esticou demais.",
  bollinger: "Olha se o candle fechou fora da banda de Bollinger.",
  impulso: "Olha se os últimos minutos andaram bem mais que o normal.",
  sequencia: "Conta candles seguidos da mesma cor.",
  pullback:
    "Com as EMAs 9, 21 e 50 alinhadas, espera o preço voltar na EMA 21.",
  vwap: "Mede quanto o preço se afastou da VWAP do dia, em ATR.",
  fluxo:
    "Olha quem está agredindo (compradores ou vendedores) com volume alto.",
  exaustao: "Procura um candle muito maior que o normal (ATR).",
  "rsi-bollinger": "RSI no extremo e candle fora da Bollinger ao mesmo tempo.",
  "sr-toque":
    "Espera o preço tocar um suporte ou resistência que já segurou o preço antes.",
  "sr-rompimento":
    "Espera o candle fechar além de um suporte ou resistência já testado.",
};
export const directionText = (id: string) =>
  (id.includes(":reverter")
    ? "Entra contra o movimento."
    : "Entra a favor do movimento.") +
  (id.endsWith(":tendencia")
    ? " Só opera a favor da tendência (não vende em alta nem compra em baixa)."
    : id.endsWith(":lateral")
      ? " Só opera com o mercado lateral."
      : "");
