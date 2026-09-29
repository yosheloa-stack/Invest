export const pct = (n: number | null | undefined, digits = 1) =>
  n == null ? "—" : `${(n * 100).toFixed(digits).replace(".", ",")}%`;
export const price = (n: number | null | undefined) => {
  if (n == null) return "—";
  const digits = n >= 1000 ? 2 : n >= 10 ? 3 : n >= 1 ? 4 : 5;
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};
export const clock = (t: number) =>
  new Date(t).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
export const countdown = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
// EURUSDT is shown as EUR/USD; crypto pairs keep the coin ticker.
export const pair = (symbol: string) =>
  symbol === "EURUSDT" ? "EUR/USD" : symbol.replace("USDT", "/USDT");
export const ticker = (symbol: string) =>
  symbol === "EURUSDT" ? "EUR/USD" : symbol.replace("USDT", "");
export const COIN_NAMES: Record<string, string> = {
  BTCUSDT: "Bitcoin",
  ETHUSDT: "Ethereum",
  SOLUSDT: "Solana",
  BNBUSDT: "BNB",
  XRPUSDT: "XRP",
  DOGEUSDT: "Dogecoin",
  ADAUSDT: "Cardano",
  AVAXUSDT: "Avalanche",
  LTCUSDT: "Litecoin",
  LINKUSDT: "Chainlink",
  EURUSDT: "Euro / Dólar",
};
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    credentials: "same-origin",
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(Error(body.error || `Erro ${r.status}`), {
      status: r.status,
      body,
    });
  return body as T;
}
// Server status strings are upper-case codes; show them as normal sentences.
export const sentence = (s: string | null | undefined) => {
  if (!s) return "";
  const t = s
    .toLocaleLowerCase("pt-BR")
    .replace(/\b(btc|eth|sol|rsi|vwap|ema\d*|ia|atr|usdt)\b/g, (m) =>
      m.toUpperCase(),
    );
  return t.charAt(0).toUpperCase() + t.slice(1);
};
