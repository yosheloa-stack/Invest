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
  SYMBOLS: z.string().default("BTCUSDT,ETHUSDT,SOLUSDT"),
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
  PAYOUT: z.coerce.number().positive().max(1).default(0.8),
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
});
export const config = schema.parse(process.env);
export const symbols = config.SYMBOLS.split(",").map((x) =>
  x.trim().toUpperCase(),
);
if (
  !symbols.length ||
  symbols.some((x) => !/^([A-Z0-9]{2,15})USDT$/.test(x)) ||
  new Set(symbols).size !== symbols.length
)
  throw Error("SYMBOLS inválidos ou duplicados");
export const weights = z
  .record(z.number().min(0).max(10))
  .parse(JSON.parse(config.GROUP_WEIGHTS));
