import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NewsIntelligenceEngine } from "../src/news.js";
import { Store } from "../src/store.js";
import { readFile } from "node:fs/promises";
import type { Features, Signal } from "../src/types.js";
test("SQLite integration: migrations, observations, strict settlement, durable outbox, stats and news", async () => {
  const dir = await mkdtemp(join(tmpdir(),"scanner-sqlite-"));
  const store = new Store(join(dir,"scanner.sqlite"));
  const query = store.pool.query.bind(store.pool);
  try {
    await store.init();
    store.pool.exec(await readFile("migrations/001_initial.sql", "utf8"));
    await store.candles("BTCUSDT","1m",[{t:60000,end:119999,o:100,h:102,l:99,c:101,v:20,q:2020,n:4,buyV:12,buyQ:1212,closed:true} as any]);
    await store.candles("BTCUSDT","1m",[{t:60000,end:119999,o:100,h:103,l:99,c:102,v:21,q:2142,n:5,buyV:13,buyQ:1326,closed:true} as any]);
    assert.equal(query("SELECT body FROM candles").rows[0]!.body.c,102);
    assert.equal(query("SELECT count(*) AS n FROM candles").rows[0]!.n,1);
    const f = {
      version: "market-v1",
      symbol: "BTCUSDT",
      horizon: 5,
      t: 1000000,
      price: 100,
      vector: [],
      names: [],
      indicators: {},
      groups: {},
      details: {},
      newsIds: [],
    } as unknown as Features;
    await store.observation(f);
    await store.observation(f);
    const initial = await query(
      "SELECT count(*) AS count FROM observations",
    );
    assert.equal((initial.rows[0] as any).count, 1);
    await store.snapshot({
      symbol: "BTCUSDT",
      t: 1300100,
      eventT: 1300050,
      quoteT: 1300100,
      price: 101,
      bid: 100.99,
      ask: 101.01,
      volume: 20,
      volatility: 0.001,
    });
    await store.settleObservations(1302000);
    const settled = await query("SELECT * FROM observations");
    assert.equal((settled.rows[0] as any).status, "SETTLED");
    assert.equal((settled.rows[0] as any).label, 2);
    await store.observation({ ...f, t: 2000000 });
    await store.snapshot({
      symbol: "BTCUSDT",
      t: 2305000,
      eventT: 2305000,
      quoteT: 2305000,
      price: 500,
      bid: 499,
      ask: 501,
      volume: 20,
      volatility: 0.001,
    });
    await store.settleObservations(2310000);
    const missing = await query(
      "SELECT status FROM observations WHERE t=2000000",
    );
    assert.equal((missing.rows[0] as any).status, "NO_DATA");
    const signal = {
      id: "test-signal",
      symbol: "BTCUSDT",
      horizon: 5,
      t: 1000000,
      probability: 0.7,
      direction: "COMPRA",
      features: f,
      status: "SETTLED",
      result: "WIN",
      modelId: "test-only",
      return: 0.01,
    } as Signal;
    await store.saveSignal(signal, true);
    await store.saveSignal(signal, true);
    assert.equal(
      (await query("SELECT count(*) AS n FROM outbox")).rows[0].n,
      1,
    );
    await store.saveDecision(f, {
      horizon: 5,
      state: "COMPRA",
      reason: "TEST",
      probability: 0.7,
      probabilities: [0.1, 0.2, 0.7],
      favorable: [],
      contrary: [],
    });
    const stats = await store.stats();
    assert.equal(stats.total, 1);
    assert.equal(stats.wins, 1);
    assert.equal(stats.winRate, 1);
    assert.equal(stats.calibration.find((b) => b.count)?.observed, 1);
    assert.ok(Math.abs(stats.breakEven - 1 / 1.8) < 1e-10);
    await store.saveNews({
      id: "news-test",
      title: "Test",
      content: "Fixture only",
      source: "test",
      url: "https://example.com",
      publishedAt: Date.now(),
      receivedAt: Date.now(),
      availableAt: null,
      classification: null,
      embedding: null,
      fingerprint: "fixture",
    });
    assert.equal((await store.recentNews()).length, 1);
    const engine = new NewsIntelligenceEngine(store);
    const event = {
      id: "reaction-fixture",
      title: "test",
      content: "fixture",
      source: "test",
      url: "https://example.com",
      publishedAt: 1300200,
      receivedAt: 1300200,
      availableAt: 1300200,
      embedding: null,
      fingerprint: "reaction-fixture",
      classification: {
        assets: ["BTC"],
        sentiment: "positive" as const,
        impact_score: 9,
        relevance: 1,
        confidence: 0.8,
        expected_horizon: "short_term" as const,
        event_type: "etf",
        summary: "fixture",
        reasoning_summary: "fixture",
      },
    };
    await store.saveNews(event);
    engine.events = [event];
    await store.snapshot({
      symbol: "BTCUSDT",
      t: 1360200,
      eventT: 1360200,
      quoteT: 1360200,
      price: 102,
      bid: 101.99,
      ask: 102.01,
      volume: 40,
      volatility: 0.002,
    });
    await engine.reactions(1363000);
    const reaction = (
      await query(
        "SELECT * FROM reactions WHERE news_id='reaction-fixture' AND horizon=1",
      )
    ).rows[0];
    assert.equal(reaction.status, "MEASURED");
    assert.equal(reaction.confirmed, true);
    assert.ok(Math.abs(Number(reaction.return) - (102 / 101 - 1)) < 1e-10);
    await engine.reactions(1363000);
    assert.equal(
      (
        await query(
          "SELECT count(*) AS n FROM reactions WHERE news_id='reaction-fixture'",
        )
      ).rows[0].n,
      1,
    );
    assert.equal((await engine.categories()).length, 1);
    await store.settleObservations(Date.now());
    assert.equal((await store.nearest("BTCUSDT", 1300000))?.price, 101);
    assert.equal(await store.nearest("BTCUSDT", 1300000, true), null);
  } finally {
    await store.close();
    await rm(dir,{recursive:true,force:true});
  }
});
