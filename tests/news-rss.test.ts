import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRss, keywordClassification } from "../src/news.js";
test("RSS público é lido e classificado por palavras-chave sem IA", () => {
  const now = new Date().toUTCString();
  const xml = `<rss><channel><item><title><![CDATA[Bitcoin surges as ETF inflows hit record high]]></title>
<link>https://example.com/a</link><pubDate>${now}</pubDate>
<description><![CDATA[<p>BTC &amp; ETH rally.</p>]]></description></item>
<item><title>Exchange hacked, Solana drops</title><link>https://example.com/b</link><pubDate>${now}</pubDate><description>SOL falls</description></item>
<item><title>sem data</title><link>https://example.com/c</link></item></channel></rss>`;
  const items = parseRss(xml, "Teste");
  assert.equal(items.length, 2);
  assert.equal(items[0].content, "BTC & ETH rally.");
  const a = keywordClassification(items[0]),
    b = keywordClassification(items[1]);
  assert.deepEqual(a.assets, ["BTC", "ETH"]);
  assert.equal(a.sentiment, "positive");
  assert.equal(a.event_type, "etf");
  assert.equal(b.sentiment, "negative");
  assert.equal(b.event_type, "hack");
  assert.ok(a.confidence < 0.5);
});
