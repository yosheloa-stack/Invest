export const pct = (n: number | null | undefined, digits = 1) =>
  n == null ? "—" : `${(n * 100).toFixed(digits).replace(".", ",")}%`;
export const price = (n: number | null | undefined) => {
  if (n == null) return "—";
  const digits =
    n >= 1000 ? 2 : n >= 10 ? 3 : n >= 0.01 ? 5 : n >= 0.0001 ? 7 : 9;
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
// Preserve the actual quote asset. EUR/USDT is not Forex EUR/USD.
export const isFx = (symbol: string) => /^[A-Z]{6}$/.test(symbol);
export const pair = (symbol: string) =>
  isFx(symbol)
    ? `${symbol.slice(0, 3)}/${symbol.slice(3)}`
    : symbol.replace(/USDT$/, "/USDT");
export const ticker = (symbol: string) =>
  isFx(symbol)
    ? pair(symbol)
    : symbol === "EURUSDT"
      ? "EUR/USDT"
      : symbol.replace("USDT", "");
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
  EURUSDT: "Euro / Tether · Binance spot",
  TRXUSDT: "TRON",
  DOTUSDT: "Polkadot",
  TONUSDT: "Toncoin",
  SHIBUSDT: "Shiba Inu",
  PEPEUSDT: "Pepe",
  BCHUSDT: "Bitcoin Cash",
  NEARUSDT: "NEAR",
  SUIUSDT: "Sui",
  UNIUSDT: "Uniswap",
  ATOMUSDT: "Cosmos",
  POLUSDT: "Polygon",
  ETCUSDT: "Ethereum Classic",
  XLMUSDT: "Stellar",
  EURUSD: "Euro / Dólar",
  GBPUSD: "Libra / Dólar",
  USDJPY: "Dólar / Iene",
  AUDUSD: "Dólar australiano / Dólar",
  USDCAD: "Dólar / Dólar canadense",
  USDCHF: "Dólar / Franco suíço",
  EURJPY: "Euro / Iene",
  EURGBP: "Euro / Libra",
  NZDUSD: "Dólar neozelandês / Dólar",
  GBPJPY: "Libra / Iene",
  AUDJPY: "Dólar australiano / Iene",
  EURAUD: "Euro / Dólar australiano",
  EURCAD: "Euro / Dólar canadense",
  EURCHF: "Euro / Franco suíço",
  GBPCHF: "Libra / Franco suíço",
  GBPAUD: "Libra / Dólar australiano",
  AUDCAD: "Dólar australiano / Dólar canadense",
  CADJPY: "Dólar canadense / Iene",
  CHFJPY: "Franco suíço / Iene",
  NZDJPY: "Dólar neozelandês / Iene",
  XAUUSD: "Ouro",
  XAGUSD: "Prata",
  USOIL: "Petróleo WTI",
  UKOIL: "Petróleo Brent",
  US100: "Nasdaq 100",
  US500: "S&P 500",
  US30: "Dow Jones",
  GER40: "DAX Alemanha",
  UK100: "FTSE 100",
  JP225: "Nikkei 225",
  AAPL: "Apple",
  TSLA: "Tesla",
  AMZN: "Amazon",
  MSFT: "Microsoft",
  NVDA: "Nvidia",
  META: "Meta",
  GOOGL: "Google",
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
