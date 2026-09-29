import { parentPort, workerData } from "node:worker_threads";
// Native type stripping supports development on Node 22.16+; production uses JS.
const { buildSeries, evaluateSymbol } = (await import(new URL(import.meta.url.endsWith(".ts") ? "./strategies.ts" : "./strategies.js", import.meta.url).href));
const { symbol, candles, horizons, options } = workerData;
parentPort.postMessage(evaluateSymbol(symbol, buildSeries(candles), horizons, options));
