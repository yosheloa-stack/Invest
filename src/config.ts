import { z } from "zod";
const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((x) => x === "true");
const schema = z.object({
  PORT: z.coerce.number().int().default(8080),
  SQLITE_PATH: z.string().default("./data/scanner.sqlite"),
  DASHBOARD_USER: z.string().default(""),
  DASHBOARD_PASSWORD: z.string().default(""),
  PUBLIC_ORIGIN: z.string().default(""),
  SYMBOLS: z
    .string()
    .default(
      "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,DOGEUSDT,ADAUSDT,BNBUSDT,AVAXUSDT,LTCUSDT,LINKUSDT,EURUSDT",
    ),
  ALLOW_SIGNUP: z
    .enum(["true", "false"])
    .default("true")
    .transform((x) => x === "true"),
  RETENTION_DAYS: z.coerce.number().min(1).default(7),
  BINANCE_REST: z.string().url().default("https://data-api.binance.vision"),
  BINANCE_WS: z
    .string()
    .url()
    .default("wss://data-stream.binance.vision/stream"),
  STALE_MS: z.coerce.number().positive().default(5000),
  MAX_CLOCK_UNCERTAINTY_MS: z.coerce.number().positive().default(1000),
  MODE: z.literal("PAPER").default("PAPER"),
  SNIPER: bool,
  NEWS_REQUIRED: bool,
  PAYOUT: z.coerce.number().positive().max(1).default(0.9),
  RETURN_THRESHOLD: z.coerce.number().min(0).default(0.0005),
  MIN_PROBABILITY: z.coerce.number().min(0.5).max(0.99).default(0.6),
  MIN_GROUPS: z.coerce.number().int().min(2).max(8).default(4),
  COOLDOWN_MS: z.coerce.number().min(60000).default(300000),
  STRATEGY_DAYS: z.coerce.number().min(3).max(90).default(30),
  STRATEGY_REFRESH_HOURS: z.coerce.number().min(1).default(6),
  STRATEGY_MIN_TRADES: z.coerce.number().int().min(30).default(100),
  STRATEGY_Z: z.coerce.number().min(1).max(5).default(1.96),
  MODEL_DIR: z.string().default("./models"),
  MODEL_MAX_AGE_DAYS: z.coerce.number().positive().default(14),
  NEWS_URL: z.string().default(""),
  NEWS_API_KEY: z.string().default(""),
  LLM_BASE_URL: z.string().default(""),
  LLM_API_KEY: z.string().default(""),
  LLM_MODEL: z.string().default(""),
  EMBEDDING_MODEL: z.string().default(""),
  GROUP_WEIGHTS: z
    .string()
    .default(
      '{"trend":1,"momentum":1,"structure":1,"volume":1,"flow":1,"mtf":1,"news":1,"reaction":1}',
    ),
  LOG_LEVEL: z.string().default("info"),
  ROBOT_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((x) => x === "true"),
  ROBOT_STAKE: z.coerce.number().positive().default(10),
  ROBOT_BANKROLL: z.coerce.number().positive().default(1000),
  ROBOT_MAX_OPEN: z.coerce.number().int().min(1).max(11).default(3),
  ROBOT_MIN_TRADES: z.coerce.number().int().min(10).default(30),
  ROBOT_MIN_WINRATE: z.coerce.number().min(0).max(0.99).default(0),
  ANTHROPIC_API_KEY: z.string().trim().default(""),
  ROBOT_AI_MODEL: z.string().trim().default("claude-opus-5"),
  ROBOT_AI_MAX_PER_HOUR: z.coerce.number().int().min(0).default(30),
  // Forex pairs (Yahoo Finance, polled; no volume). Empty disables Forex.
  FOREX_SYMBOLS: z
    .string()
    .default("EURUSD,GBPUSD,USDJPY,AUDUSD,USDCAD,USDCHF,EURJPY,EURGBP,NZDUSD"),
  FX_POLL_MS: z.coerce.number().int().min(2000).default(8000),
  FX_STALE_MS: z.coerce.number().int().min(5000).default(30000),
});
export const config = schema.parse(process.env);
const crypto = config.SYMBOLS.split(",").map((x) => x.trim().toUpperCase());
if (
  !crypto.length ||
  crypto.some((x) => !/^([A-Z0-9]{2,15})USDT$/.test(x)) ||
  new Set(crypto).size !== crypto.length
)
  throw Error("SYMBOLS inválidos ou duplicados");
export const fxSymbols = config.FOREX_SYMBOLS.split(",")
  .map((x) => x.trim().toUpperCase())
  .filter(Boolean);
if (
  fxSymbols.some((x) => !/^[A-Z]{6}$/.test(x) || crypto.includes(x)) ||
  new Set(fxSymbols).size !== fxSymbols.length
)
  throw Error("FOREX_SYMBOLS inválidos ou duplicados");
// Crypto first, then Forex pairs.
export const symbols = [...crypto, ...fxSymbols];
export const isFx = (symbol: string) => fxSymbols.includes(symbol);
// Forex prices are polled, so they are allowed to be older than exchange trades.
export const staleMs = (symbol: string) =>
  isFx(symbol) ? config.FX_STALE_MS : config.STALE_MS;
export const weights = z
  .record(z.number().min(0).max(10))
  .parse(JSON.parse(config.GROUP_WEIGHTS));
