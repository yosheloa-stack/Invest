/** Replay held-out observations through the same confluence and paper state machine.
 * Every input is a prospectively stored feature or observed quote. Missing ticks
 * invalidate entries and leave expired trades NO_DATA rather than interpolating.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { evaluate, advanceSignal } from "../src/signals.js";
import { modelSchema, type ModelRegistry } from "../src/models.js";
import { config } from "../src/config.js";
import type { Features, Signal } from "../src/types.js";
const [
  datasetPath,
  modelDir = "research/candidates",
  output = "research/replay-report.json",
] = process.argv.slice(2);
if (!datasetPath)
  throw Error(
    "Usage: npm run replay -- dataset.json model-directory report.json",
  );
const data = JSON.parse(await readFile(datasetPath, "utf8"));
if (
  data.source !== "prospective-market-observations" ||
  data.threshold !== config.RETURN_THRESHOLD
)
  throw Error("Dataset incompatível");
const models = new Map<
  string,
  { model: ReturnType<typeof modelSchema.parse>; testStart: number }
>();
for (const file of (await readdir(modelDir)).filter((f) =>
  /-(5|10|15)\.json$/.test(f),
)) {
  const raw = JSON.parse(await readFile(modelDir + "/" + file, "utf8")),
    model = modelSchema.parse(raw);
  models.set(`${model.symbol}:${model.horizon}`, {
    model,
    testStart: raw.testStart,
  });
}
const registry = {
  get(f: Features) {
    const found = models.get(`${f.symbol}:${f.horizon}`);
    if (
      !found ||
      !Number.isFinite(found.testStart) ||
      f.t < found.testStart ||
      f.t > found.model.testEnd
    )
      throw Error("OUTSIDE UNTOUCHED TEST");
    return found.model;
  },
} as ModelRegistry;
const events = [
  ...data.rows.map((r: any) => ({ t: Number(r.t), kind: "observation", r })),
  ...(data.snapshots || []).map((r: any) => ({
    t: Number(r.t),
    kind: "quote",
    r,
  })),
].sort((a, b) => a.t - b.t || (a.kind === "quote" ? -1 : 1));
const active = new Map<string, Signal>(),
  completed: Signal[] = [],
  cooldown = new Map<string, number>(),
  lastTick = new Map<string, number>();
let tested = 0;
for (const event of events) {
  if (event.kind === "quote") {
    const q = event.r,
      quote = { t: Number(q.quote_t), bid: Number(q.bid), ask: Number(q.ask) };
    if (!Number.isFinite(quote.t)) continue;
    for (const [id, s] of active) {
      if (s.symbol !== q.symbol) continue;
      const healthy = event.t - (lastTick.get(q.symbol) || event.t) <= 2500;
      const next = advanceSignal(s, quote, event.t, healthy);
      if (["PENDING", "FILLED"].includes(next.status)) active.set(id, next);
      else {
        completed.push(next);
        active.delete(id);
      }
    }
    lastTick.set(q.symbol, event.t);
  } else {
    const f = event.r.features as Features,
      key = `${f.symbol}:${f.horizon}`;
    const candidate = models.get(key);
    if (
      !candidate ||
      f.t < candidate.testStart ||
      f.t > candidate.model.testEnd
    )
      continue;
    tested++;
    const d = evaluate(
      f,
      registry,
      f.vector[f.names.indexOf("newsAvailable")] === 1,
      config.SNIPER,
    );
    if (
      d.signal &&
      f.t - (cooldown.get(key) || 0) >= config.COOLDOWN_MS &&
      ![...active.values()].some(
        (s) => s.symbol === f.symbol && s.horizon === f.horizon,
      )
    ) {
      active.set(d.signal.id, d.signal);
      cooldown.set(key, f.t);
    }
  }
}
for (const s of active.values())
  completed.push({ ...s, status: "NO_DATA", reason: "END OF ARCHIVED QUOTES" });
const settled = completed.filter((s) => s.status === "SETTLED"),
  wins = settled.filter((s) => s.result === "WIN").length,
  losses = settled.filter((s) => s.result === "LOSS").length,
  neutrals = settled.filter((s) => s.result === "NEUTRO").length;
await writeFile(
  output,
  JSON.stringify(
    {
      kind: "held-out-confluence-paper-replay",
      tested,
      signals: completed.length,
      settled: settled.length,
      wins,
      losses,
      neutrals,
      winRate: wins + losses ? wins / (wins + losses) : null,
      assumptions:
        "Observed 1-second snapshots; no interpolation. No market orders, fees or binary-broker price reproduction. Compare against prospectively executed paper ledger.",
      ledger: completed,
    },
    null,
    2,
  ),
);
console.log(output);
