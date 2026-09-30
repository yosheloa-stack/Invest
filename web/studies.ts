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
export { priceContext } from "../src/price-context";
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
    extra: Study[] = id?.includes(":ctx2") ? ["sr"] : [];
  return [...extra, ...byFamily(family)];
}
function byFamily(family: string | undefined): Study[] {
  switch (family) {
    case "estrutura":
    case "lateral":
    case "fibonacci":
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
    case "confluencia":
      return ["ema"];
    case "stoch-rsi":
    case "macd":
      return ["rsi"];
    case "squeeze":
      return ["bb"];
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
  estrutura:
    "Na tendência, espera o preço voltar na linha de tendência (LTA/LTB) e rejeitar.",
  lateral:
    "Com o mercado lateral, entra só na borda da faixa quando o preço rejeita.",
  fibonacci:
    "Na tendência, espera o recuo até a zona de 38,2% a 61,8% e a retomada.",
  "sr-toque":
    "Espera o preço tocar um suporte ou resistência que já segurou o preço antes.",
  "sr-rompimento":
    "Espera o candle fechar além de um suporte ou resistência já testado.",
  supertrend:
    "SuperTrend (TradingView): faixa de ATR que segue o preço; entra quando a tendência vira.",
  utbot:
    "UT Bot Alerts (TradingView): stop móvel de ATR; entra quando o preço cruza o stop.",
  squeeze:
    "Squeeze Momentum (LazyBear): Bollinger dentro do Keltner é aperto; entra quando o aperto solta.",
  ichimoku: "Ichimoku: Tenkan cruzando Kijun, ou fechamento saindo da nuvem.",
  "stoch-rsi":
    "Stoch RSI: a linha K cruza a D saindo da zona de sobrevenda ou sobrecompra.",
  macd: "MACD 12/26/9: a linha cruza o sinal, com filtro do zero ou do RSI.",
  adx: "ADX/DMI: +DI cruza -DI quando o ADX mostra tendência forte.",
  "heikin-ashi": "Heikin Ashi: vira de cor com candle forte, sem pavio contra.",
  donchian:
    "Canal Donchian (Turtle): fechamento rompe a máxima ou mínima do canal.",
  psar: "Parabolic SAR: entra quando os pontos trocam de lado.",
  confluencia:
    "Só entra quando SuperTrend, MACD, Ichimoku, Heikin Ashi e EMAs passam a concordar.",
};
export const directionText = (id: string) =>
  (id.includes(":reverter")
    ? "Entra contra o movimento."
    : "Entra a favor do movimento.") +
  (id.includes(":ctx2")
    ? " Só entra a favor da tendência, ou na borda de uma lateral com rejeição."
    : "");
