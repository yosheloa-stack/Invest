import { test } from "node:test";
import assert from "node:assert/strict";
import { paperFeedback, applyPaperFeedback } from "../src/paper-feedback.js";
import type { Signal, Decision } from "../src/types.js";
const now = 1800000000000;
const candidate = {
  symbol: "BTCUSDT",
  horizon: 5,
  modelId: "estrategia:test:ctx2",
} as Signal;
const rows = (n: number, wins = 0) =>
  Array.from(
    { length: n },
    (_, i) =>
      ({
        ...candidate,
        id: String(i),
        status: "SETTLED",
        result: i < wins ? "WIN" : "LOSS",
        exitAt: now - 1000 - i * 60000,
      }) as Signal,
  );
test("three losses are not a statistically adequate sample for automatic suspension", () =>
  assert.equal(paperFeedback(candidate, rows(3), now, 0.8).paused, false));
test("consistently poor same-strategy results pause for one hour without inflating confidence", () => {
  const p = paperFeedback(candidate, rows(20, 2), now, 0.8);
  assert.equal(p.paused, true);
  assert.equal(p.count, 20);
  assert.equal(p.winRate, 0.1);
  assert.equal(p.until, now - 1000 + 3600000);
  const d = {
    state: "COMPRA",
    signal: candidate,
    probability: 0.65,
    contrary: [],
    reason: "test",
  } as unknown as Decision;
  const blocked = applyPaperFeedback(d, rows(20, 2), now, 0.8);
  assert.equal(blocked.signal, undefined);
  assert.equal(blocked.probability, 0.65);
  assert.match(blocked.reason, /PAUSA PELO HISTÓRICO/);
  assert.equal(
    paperFeedback(candidate, rows(20, 2), now + 3600000, 0.8).paused,
    false,
  );
});
test("unrelated versions, assets, horizons, future and unresolved outcomes cannot poison the gate", () => {
  const bad = rows(20).flatMap((s) => [
    { ...s, id: s.id + "a", symbol: "ETHUSDT" },
    { ...s, id: s.id + "b", horizon: 15 },
    { ...s, id: s.id + "c", modelId: "old" },
    { ...s, id: s.id + "d", status: "NO_DATA" },
    { ...s, id: s.id + "e", result: "NEUTRO" },
    { ...s, id: s.id + "f", exitAt: now + 1 },
  ]) as Signal[];
  assert.equal(paperFeedback(candidate, bad, now, 0.8).count, 0);
});
test("history is deduplicated, chronological and limited to 50 settled outcomes in seven days", () => {
  const h = rows(60);
  assert.equal(
    paperFeedback(candidate, [...h, ...h].reverse(), now, 0.8).count,
    50,
  );
  assert.equal(paperFeedback(candidate, h, now + 8 * 86400000, 0.8).count, 0);
});
test("healthy paper outcomes keep the original decision untouched", () => {
  const d = { signal: candidate } as Decision;
  assert.equal(applyPaperFeedback(d, rows(30, 25), now, 0.8), d);
});
