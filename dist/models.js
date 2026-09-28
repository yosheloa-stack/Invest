import { readFile, readdir } from "node:fs/promises";
import { z } from "zod";
import { config } from "./config.js";
import { FEATURE_NAMES, FEATURE_VERSION } from "./features.js";
import { log } from "./log.js";
const nums = z.array(z.number().finite());
export const modelSchema = z.object({
    id: z.string(),
    symbol: z.string(),
    horizon: z.union([z.literal(5), z.literal(10), z.literal(15)]),
    featureVersion: z.literal(FEATURE_VERSION),
    featureNames: z.array(z.string()),
    classes: z.tuple([z.literal(0), z.literal(1), z.literal(2)]),
    mean: nums,
    scale: nums,
    coef: z.array(nums).length(3),
    intercept: nums.length(3),
    temperature: z.number().positive(),
    threshold: z.number().nonnegative(),
    createdAt: z.number(),
    trainEnd: z.number(),
    calibrationEnd: z.number(),
    testEnd: z.number(),
    sampleCount: z.number().int().min(1500),
    testCount: z.number().int().min(200),
    metrics: z.object({
        brier: z.number().min(0).max(2),
        ece: z.number().min(0).max(1),
        logLoss: z.number().nonnegative(),
    }),
    walkForward: z
        .array(z.object({
        trainEnd: z.number(),
        testStart: z.number(),
        testEnd: z.number(),
        count: z.number(),
        brier: z.number(),
    }))
        .min(2),
});
export function predict(m, f) {
    if (f.vector.length !== m.mean.length)
        throw Error("DIMENSÃO INCOMPATÍVEL");
    const x = f.vector.map((v, i) => (v - m.mean[i]) / m.scale[i]);
    if (x.some((v) => !Number.isFinite(v) || Math.abs(v) > 12))
        throw Error("FORA DA DISTRIBUIÇÃO DO MODELO");
    const logits = m.coef.map((c, k) => c.reduce((s, w, i) => s + w * x[i], m.intercept[k]) / m.temperature), mx = Math.max(...logits), ex = logits.map((v) => Math.exp(v - mx)), sum = ex.reduce((a, b) => a + b, 0);
    return ex.map((v) => v / sum);
}
export class ModelRegistry {
    models = new Map();
    errors = {};
    async load() {
        this.models.clear();
        this.errors = {};
        const files = await readdir(config.MODEL_DIR).catch(() => []);
        for (const file of files.filter((f) => f.endsWith(".json"))) {
            try {
                const m = modelSchema.parse(JSON.parse(await readFile(config.MODEL_DIR + "/" + file, "utf8")));
                if (JSON.stringify(m.featureNames) !== JSON.stringify(FEATURE_NAMES) ||
                    m.mean.length !== FEATURE_NAMES.length ||
                    m.scale.length !== FEATURE_NAMES.length ||
                    m.scale.some((s) => s <= 0) ||
                    m.coef.some((c) => c.length !== FEATURE_NAMES.length))
                    throw Error("SCHEMA DE FEATURES INCOMPATÍVEL");
                if (m.threshold !== config.RETURN_THRESHOLD)
                    throw Error("THRESHOLD INCOMPATÍVEL");
                if (!(m.trainEnd < m.calibrationEnd &&
                    m.calibrationEnd < m.testEnd &&
                    m.testEnd <= m.createdAt &&
                    m.createdAt <= Date.now()))
                    throw Error("TEMPORALIDADE INVÁLIDA");
                this.models.set(`${m.symbol}:${m.horizon}`, m);
            }
            catch (e) {
                this.errors[file] = String(e);
                log.warn({ file, error: String(e) }, "modelo rejeitado");
            }
        }
    }
    get(f) {
        const m = this.models.get(`${f.symbol}:${f.horizon}`);
        if (!m)
            throw Error("MODELO NÃO CARREGADO — DADOS INSUFICIENTES PARA CONFIANÇA CALIBRADA");
        if (f.t <= m.testEnd ||
            f.t - m.testEnd > config.MODEL_MAX_AGE_DAYS * 86400000)
            throw Error("MODELO EXPIRADO / TEMPORALIDADE INVÁLIDA");
        return m;
    }
    summary() {
        return [...this.models.values()].map((m) => ({
            id: m.id,
            symbol: m.symbol,
            horizon: m.horizon,
            createdAt: m.createdAt,
            testEnd: m.testEnd,
            sampleCount: m.sampleCount,
            testCount: m.testCount,
            metrics: m.metrics,
        }));
    }
}
