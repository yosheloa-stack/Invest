import { parentPort, workerData } from "node:worker_threads";
import type { LabOptions } from "./strategies.js";
import type { Candle, Horizon } from "./types.js";
// Native type stripping supports development on Node 22.16+; production uses JS.
const { buildSeries, evaluateSymbol } = (await import(
  new URL(
    import.meta.url.endsWith(".ts") ? "./strategies.ts" : "./strategies.js",
    import.meta.url,
  ).href
)) as typeof import("./strategies.js");
const { symbol, candles, horizons, options } = workerData as {
  symbol: string;
  candles: Candle[];
  horizons: Horizon[];
  options: LabOptions;
};
parentPort!.postMessage(
  evaluateSymbol(symbol, buildSeries(candles), horizons, options),
);
