import type { MarketRead } from "./robot.js";
import type { PatternHit } from "./patterns.js";
// "Quase entrando": assets where something is about to happen, so the user can open the
// chart before the entry. Pure: built from the robot's reading and the pattern scan.
export interface RadarItem {
  symbol: string;
  t: number;
  score: number;
  bias: 1 | -1 | 0;
  title: string;
  detail: string;
  level: number | null;
}
export function radarFor(
  symbol: string,
  read: MarketRead | null | undefined,
  patterns: { candles: PatternHit[]; charts: PatternHit[] },
  t: number,
): RadarItem[] {
  const out: RadarItem[] = [];
  if (read?.pick)
    out.push({
      symbol,
      t,
      score: 4,
      bias: read.pick.direction === "COMPRA" ? 1 : -1,
      title: `Entrada agora: ${read.pick.direction.toLowerCase()} ${read.pick.horizon} min`,
      detail: read.pick.label,
      level: null,
    });
  else if (read?.near)
    out.push({
      symbol,
      t,
      score: 3,
      bias: read.near.direction === "COMPRA" ? 1 : -1,
      title: `Quase entrando: ${read.near.direction.toLowerCase()} ${read.near.horizon} min`,
      detail: `${read.near.label}. Falta ${read.near.need - read.near.have} estratégia confirmar.`,
      level: null,
    });
  for (const p of patterns.charts) {
    if (p.status !== "formando" || p.distance == null || p.distance > 1)
      continue;
    out.push({
      symbol,
      t,
      score: p.distance <= 0.5 ? 2.5 : 2,
      bias: p.bias,
      title: `${p.name} perto de romper`,
      detail: p.action,
      level: p.level,
    });
  }
  for (const p of patterns.candles) {
    if (!p.bias) continue;
    // A reversal candle counts more when it sits on the robot's support or resistance.
    const atLevel =
      read?.atrPct != null &&
      ((p.bias === 1 &&
        read.support != null &&
        Math.abs(read.price - read.support) / read.price <= 2 * read.atrPct) ||
        (p.bias === -1 &&
          read.resistance != null &&
          Math.abs(read.resistance - read.price) / read.price <=
            2 * read.atrPct));
    out.push({
      symbol,
      t,
      score: atLevel ? 1.8 : 1,
      bias: p.bias,
      title: `${p.name} em M5${atLevel ? (p.bias === 1 ? " no suporte" : " na resistência") : ""}`,
      detail: p.action,
      level: p.level,
    });
  }
  return out;
}
