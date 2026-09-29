import { randomUUID } from "node:crypto";
import { config, weights } from "./config.js";
import type { Decision, Features, Signal, Quote } from "./types.js";
import { predict, type ModelRegistry } from "./models.js";
import type { StrategyPick } from "./lab.js";
// A historical edge never overrides a contrary current trend/timeframe.
export function contraryContext(f: Features, direction: number): boolean {
  return [f.groups.trend, f.groups.mtf, f.details.micro, f.details.macro].some(
    (v) => typeof v === "number" && v * direction < 0,
  );
}
export function evaluate(
  f: Features,
  registry: ModelRegistry,
  newsReady: boolean,
  sniper: boolean,
): Decision {
  const base: Decision = {
    horizon: f.horizon,
    state: "SEM ENTRADA",
    reason: "CONFLUÊNCIA INSUFICIENTE",
    probability: null,
    favorable: [],
    contrary: [],
  };
  try {
    const model = registry.get(f),
      probs = predict(model, f),
      direction = probs[2] >= probs[0] ? 1 : -1,
      probability = direction === 1 ? probs[2] : probs[0];
    const favorable = Object.entries(f.groups)
        .filter(([k, v]) => v === direction && (weights[k] ?? 1) > 0)
        .map(([k]) => k),
      contrary = Object.entries(f.groups)
        .filter(([k, v]) => v === -direction && (weights[k] ?? 1) > 0)
        .map(([k]) => k);
    const total = Object.keys(f.groups).reduce(
        (s, k) => s + (weights[k] ?? 1),
        0,
      ),
      score = total
        ? Object.entries(f.groups).reduce(
            (s, [k, v]) => s + v * direction * (weights[k] ?? 1),
            0,
          ) / total
        : 0;
    const d = {
      ...base,
      probability,
      probabilities: probs,
      score,
      favorable,
      contrary,
    };
    if ((config.NEWS_REQUIRED || sniper) && !newsReady)
      return {
        ...d,
        state: "ANÁLISE INDISPONÍVEL",
        reason: "NOTÍCIAS / IA NÃO CONFIGURADAS OU INDISPONÍVEIS",
      };
    if (contraryContext(f, direction))
      return { ...d, reason: "TENDÊNCIA / TIMEFRAME CONTRÁRIO À ENTRADA" };
    if (Number(f.details.spreadBps) > 10)
      return { ...d, reason: "SPREAD ELEVADO" };
    if (Number(f.details.atrPct) > 0.02 || Number(f.details.atrPct) < 0.00005)
      return { ...d, reason: "VOLATILIDADE ANORMAL" };
    if (
      probability < config.MIN_PROBABILITY + (sniper ? 0.05 : 0) ||
      favorable.length < config.MIN_GROUPS + (sniper ? 1 : 0)
    )
      return d;
    if (contrary.length > (sniper ? 0 : 1))
      return { ...d, reason: "EVIDÊNCIAS CONTRADITÓRIAS" };
    if (
      sniper &&
      (f.groups.volume !== direction ||
        f.groups.mtf !== direction ||
        Number(f.details.relativeVolume) < 1.2)
    )
      return { ...d, reason: "SNIPER AGUARDA VOLUME E CONTEXTO" };
    if (f.details.importantNews && f.groups.reaction !== direction)
      return { ...d, reason: "AGUARDANDO REAÇÃO OBSERVADA À NOTÍCIA" };
    const tolerance = f.indicators.atr * 0.15;
    const signal: Signal = {
      id: randomUUID(),
      symbol: f.symbol,
      t: f.t,
      horizon: f.horizon,
      direction: direction === 1 ? "COMPRA" : "VENDA",
      analyzedPrice: f.price,
      entryLow: f.price - tolerance,
      entryHigh: f.price + tolerance,
      expires: f.t + 30000,
      probability,
      modelId: model.id,
      features: f,
      score,
      favorable,
      contrary,
      status: "PENDING",
    };
    return {
      ...d,
      state: signal.direction,
      reason: "CONFLUÊNCIA E MODELO DISPONÍVEIS",
      signal,
    };
  } catch (e) {
    return {
      ...base,
      state: "ANÁLISE INDISPONÍVEL",
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
export function advanceSignal(
  s: Signal,
  quote: Quote | undefined,
  now: number,
  healthy: boolean,
): Signal {
  const next = { ...s };
  if (s.status === "PENDING") {
    if (now > s.expires)
      return { ...next, status: "EXPIRED", reason: "VALIDADE EXPIRADA" };
    if (!healthy || !quote || now - quote.t > config.STALE_MS)
      return { ...next, status: "INVALIDATED", reason: "FEED INDISPONÍVEL" };
    if (quote.t <= s.t) return next;
    const entry = s.direction === "COMPRA" ? quote.ask : quote.bid;
    if (entry < s.entryLow || entry > s.entryHigh)
      return { ...next, status: "INVALIDATED", reason: "PREÇO FORA DA FAIXA" };
    return {
      ...next,
      status: "FILLED",
      entry,
      entryAt: quote.t,
      due: quote.t + s.horizon * 60000,
    };
  }
  if (s.status === "FILLED" && now >= s.due!) {
    if (
      !healthy ||
      !quote ||
      quote.t < s.due! ||
      quote.t > s.due! + 2000 ||
      now - quote.t > 2000
    ) {
      return now > s.due! + 2500
        ? {
            ...next,
            status: "NO_DATA",
            reason: "SEM COTAÇÃO VÁLIDA NO VENCIMENTO",
          }
        : next;
    }
    const exit = s.direction === "COMPRA" ? quote.bid : quote.ask,
      ret = (exit / s.entry! - 1) * (s.direction === "COMPRA" ? 1 : -1);
    return {
      ...next,
      status: "SETTLED",
      exit,
      exitAt: quote.t,
      return: ret,
      result:
        ret > config.RETURN_THRESHOLD
          ? "WIN"
          : ret < -config.RETURN_THRESHOLD
            ? "LOSS"
            : "NEUTRO",
    };
  }
  return next;
}
export interface AlertAdapter {
  channel: "telegram" | "whatsapp" | "discord" | "push";
  send(signal: Signal, idempotencyKey: string): Promise<void>;
}
// External alert adapters must be explicitly configured; no outbound message is sent by this application.
// Builds a paper signal from a strategy approved by the out-of-sample backtest.
// "probability" here is the measured out-of-sample win rate, not a model output.
export function strategyDecision(
  f: Features,
  pick: StrategyPick,
  price: number,
  now: number,
): Decision {
  const e = pick.evaluation,
    wr = e.outOfSample.winRate ?? 0,
    label = `${e.label} — acerto fora da amostra ${(wr * 100).toFixed(1)}% em ${e.outOfSample.wins + e.outOfSample.losses} operações`;
  const base: Decision = {
    horizon: f.horizon,
    state: "SEM ENTRADA",
    reason: label,
    probability: wr,
    score: e.outOfSample.lower ?? 0,
    favorable: [e.label],
    contrary: [],
  };
  if (contraryContext(f, pick.direction === "COMPRA" ? 1 : -1))
    return { ...base, reason: "TENDÊNCIA / TIMEFRAME CONTRÁRIO À ENTRADA" };
  if (Number(f.details.spreadBps) > 10)
    return { ...base, reason: "SPREAD ELEVADO" };
  if (Number(f.details.atrPct) > 0.02 || Number(f.details.atrPct) < 0.00005)
    return { ...base, reason: "VOLATILIDADE ANORMAL" };
  const tolerance = f.indicators.atr * 0.15;
  const signal: Signal = {
    id: randomUUID(),
    symbol: f.symbol,
    t: now,
    horizon: f.horizon,
    direction: pick.direction,
    analyzedPrice: price,
    entryLow: price - tolerance,
    entryHigh: price + tolerance,
    expires: now + 30000,
    probability: wr,
    modelId: `estrategia:${e.id}`,
    features: f,
    score: e.outOfSample.lower ?? 0,
    favorable: [e.label],
    contrary: [],
    status: "PENDING",
  };
  return {
    ...base,
    state: pick.direction,
    reason: `ESTRATÉGIA VALIDADA: ${label}`,
    signal,
  };
}
