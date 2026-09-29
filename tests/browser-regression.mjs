// Isolated synthetic fixtures for UI regression only; never imported by the application.
// Run after npm run build. Requires Playwright (or PLAYWRIGHT_MODULE pointing to it).
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocketServer } from "ws";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const bases = { BTCUSDT: 60000, ETHUSDT: 2000, SOLUSDT: 150 };
let signals = [],
  ticks = 0,
  blankOnce = true;
const bar = (symbol, t, i = 0) => ({
  t,
  o: bases[symbol],
  h: bases[symbol] * 1.002,
  l: bases[symbol] * 0.998,
  c: bases[symbol] * (1 + Math.sin(i) * 0.001),
  v: 10,
  buy: 5,
});
const snap = () => ({
  time: Date.now(),
  mode: "PAPER",
  database: "OK",
  newsStatus: "OK",
  newsCapabilities: {},
  news: [],
  signals,
  models: [],
  metrics: null,
  assets: Object.keys(bases).map((symbol) => ({
    symbol,
    price: bases[symbol],
    change: 0.001,
    eventTime: Date.now(),
    feed: "CONECTADO",
    reasons: [],
    forecasts: [5, 10, 15].map((horizon) => ({
      horizon,
      state: "SEM ENTRADA",
      reason: "Aguardando",
      favorable: [],
      contrary: [],
      probability: null,
    })),
    chart: [],
  })),
});
app.get("/api/auth/me", (_, res) =>
  res.json({
    user: {
      id: "fixture",
      name: "Teste",
      email: "fixture@example.invalid",
      role: "user",
    },
    allowSignup: false,
  }),
);
app.get("/api/strategies", (_, res) =>
  res.json({ evaluations: [], status: "TEST FIXTURE", approved: 0, tested: 0 }),
);
app.get("/api/candles/:symbol", async (req, res) => {
  const symbol = req.params.symbol,
    start = Math.floor(Date.now() / 60000) * 60000;
  if (symbol === "ETHUSDT") await new Promise((r) => setTimeout(r, 180));
  if (symbol === "SOLUSDT" && blankOnce) {
    blankOnce = false;
    res.json({ symbol, candles: [], signals: [], triggers: [] });
    return;
  }
  res.json({
    symbol,
    candles: Array.from({ length: 1000 }, (_, i) =>
      bar(symbol, start - (1000 - i) * 60000, i),
    ),
    signals: signals.filter((s) => s.symbol === symbol),
    triggers: [],
  });
});
app.use(express.static("public"));
wss.on("connection", (ws) => ws.send(JSON.stringify(snap())));
const timer = setInterval(() => {
  ticks++;
  const t = Date.now(),
    start = Math.floor(t / 60000) * 60000;
  for (const ws of wss.clients) {
    ws.send(
      JSON.stringify({
        type: "tick",
        t,
        k: Object.fromEntries(
          Object.keys(bases).map((symbol) => {
            const b = bar(symbol, start, ticks);
            return [symbol, [b.t, b.o, b.h, b.l, b.c, b.v, b.buy]];
          }),
        ),
      }),
    );
    if (ticks % 10 === 0) ws.send(JSON.stringify(snap()));
  }
}, 100);
server.listen(0, "127.0.0.1");
await once(server, "listening");
let browser;
try {
  const launch = { headless: true, args: ["--no-sandbox"] };
  if (process.env.CHROMIUM_MODULE) {
    const { default: c } = await import(process.env.CHROMIUM_MODULE);
    launch.executablePath = await c.executablePath();
    launch.args = c.args;
  }
  browser = await chromium.launch(launch);
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.testNotices = [];
    window.Notification = class {
      static permission = "granted";
      static async requestPermission() {
        return "granted";
      }
      constructor(title, opts) {
        window.testNotices.push({ title, ...opts });
      }
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator(".tv-title b").waitFor();
  const choose = async (symbol) => {
    await page.locator(".tv-symbol").click();
    await page.getByRole("menuitem", { name: new RegExp(symbol) }).click();
  };
  await choose("ETHUSDT");
  await page.locator(".tv-title b").filter({ hasText: "ETHUSDT" }).waitFor();
  await choose("BTCUSDT");
  await page.locator(".tv-title b").filter({ hasText: "BTCUSDT" }).waitFor();
  await page
    .getByRole("toolbar", { name: "Gráfico" })
    .getByRole("button", { name: "5m", exact: true })
    .click();
  await choose("SOLUSDT");
  await page.getByText("Histórico em preparação.", { exact: false }).waitFor();
  await page
    .locator(".tv-title b")
    .filter({ hasText: "SOLUSDT" })
    .waitFor({ timeout: 12000 });
  assert.ok((await page.locator(".chart-canvas canvas").count()) > 0);
  await page.getByRole("button", { name: "Ligar avisos" }).click();
  const n = Date.now();
  const signal = {
    id: "fixture-one",
    symbol: "SOLUSDT",
    t: n,
    horizon: 5,
    direction: "COMPRA",
    entryLow: 149,
    entryHigh: 151,
    analyzedPrice: 150,
    expires: n + 30000,
    probability: 0.61,
    modelId: "estrategia:fixture",
    favorable: [],
    status: "FILLED",
    entry: 150,
    entryAt: n,
    due: n + 300000,
  };
  signals = [signal];
  await page.waitForFunction(() =>
    window.testNotices.some((n) =>
      n.title.includes("Entrada paper registrada"),
    ),
  );
  signals = [
    {
      ...signal,
      status: "SETTLED",
      exit: 151,
      exitAt: Date.now(),
      result: "WIN",
    },
  ];
  await page.waitForFunction(() =>
    window.testNotices.some((n) => n.title.includes("GREEN")),
  );
  await page.waitForTimeout(2200);
  assert.equal(await page.evaluate(() => window.testNotices.length), 2);
  assert.equal(await page.locator(".activity-row").count(), 1);
  await page.screenshot({ path: "/tmp/invest-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await choose("ETHUSDT");
  await page.locator(".tv-title b").filter({ hasText: "ETHUSDT" }).waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    "no horizontal overflow on mobile",
  );
  await page.screenshot({ path: "/tmp/invest-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: pair switching, timeframe switching, empty-history recovery, canvas, skipped-pending alert, result notification, deduplication, mobile layout; no page errors",
  );
} finally {
  await browser?.close();
  clearInterval(timer);
  for (const ws of wss.clients) ws.terminate();
  wss.close();
  server.close();
}
