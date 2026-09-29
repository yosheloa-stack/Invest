// Runs the strategy lab once against real Binance history and writes the report.
// Usage: npm run lab -- research/strategy-report.json
import "../src/network.js";
import { writeFile } from "node:fs/promises";
import { RestClient } from "../src/market.js";
import { StrategyLab } from "../src/lab.js";
const rest = new RestClient();
await rest.sync();
const lab = new StrategyLab(rest);
await lab.run();
const out = process.argv[2] || "research/strategy-report.json",
  r = lab.summary();
await writeFile(out, JSON.stringify(r, null, 2));
console.log(r.status);
for (const e of r.evaluations)
  console.log(
    `${e.approved ? "APROVADA " : "reprovada"} ${e.symbol} ${e.horizon}m ${e.label.padEnd(60)} n=${e.outOfSample.wins + e.outOfSample.losses} acerto=${((e.outOfSample.winRate ?? 0) * 100).toFixed(1)}% min95=${((e.outOfSample.lower ?? 0) * 100).toFixed(1)}%`,
  );
if (r.error) process.exitCode = 1;
