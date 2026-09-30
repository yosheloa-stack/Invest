import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import { config } from "./config.js";
import { log } from "./log.js";
// Optional Claude analyst. Without ANTHROPIC_API_KEY the robot keeps working on rules alone.
const SYSTEM = `Você é o analista de um robô que opera opções binárias (alta/baixa com expiração de 1, 5, 10 ou 15 minutos) em SIMULAÇÃO, com dados de 1 minuto de criptomoedas.
Payout de referência: ganho de ${Math.round(config.PAYOUT * 100)}% do valor na vitória, perda de 100% na derrota; é preciso acertar mais de ${(100 / (1 + config.PAYOUT)).toFixed(1).replace(".", ",")}% para lucrar.
Você recebe a leitura técnica calculada pelo sistema (tendência, suporte, resistência, RSI, gatilhos com a taxa de acerto medida em backtest fora da amostra) e os candles recentes.
Seja cético: a maioria das entradas de curto prazo é ruído. Prefira ficar de fora quando o preço está colado em suporte/resistência contra a entrada, quando o candle é de exaustão ou quando a vantagem medida é pequena.
Escreva sempre em português do Brasil, frases curtas e diretas, sem jargão desnecessário. Nunca prometa lucro.`;
const Review = z.object({
    decisao: z.enum(["ENTRAR", "PULAR"]),
    confianca: z.number(),
    motivo: z.string(),
});
function brief(read, closed) {
    const candles = closed
        .slice(-30)
        .map((c) => `${new Date(c.t).toISOString().slice(11, 16)} a=${c.o} m=${c.h} n=${c.l} f=${c.c} v=${Math.round(c.v)}`)
        .join("\n");
    return `Ativo: ${read.symbol}\nPreço: ${read.price}\nLeitura do sistema:\n- ${read.lines.join("\n- ")}\nATR/preço: ${read.atrPct == null ? "?" : (read.atrPct * 100).toFixed(3) + "%"}\n\nÚltimos 30 candles de 1 min (hora UTC, abertura, máxima, mínima, fechamento, volume):\n${candles}`;
}
export class RobotAI {
    model;
    maxPerHour;
    client;
    calls = [];
    cache = new Map();
    lastError = null;
    constructor(key, model, maxPerHour) {
        this.model = model;
        this.maxPerHour = maxPerHour;
        this.client = key ? new Anthropic({ apiKey: key, maxRetries: 1 }) : null;
    }
    get enabled() {
        return Boolean(this.client);
    }
    get usedLastHour() {
        const now = Date.now();
        this.calls = this.calls.filter((t) => now - t < 3600000);
        return this.calls.length;
    }
    get budget() {
        return this.maxPerHour;
    }
    take() {
        if (!this.client || this.usedLastHour >= this.maxPerHour)
            return false;
        this.calls.push(Date.now());
        return true;
    }
    request(content) {
        return {
            model: this.model,
            max_tokens: 4000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            system: SYSTEM,
            messages: [{ role: "user", content }],
        };
    }
    // Second opinion before a simulated entry. null = not asked (no key, no budget or error).
    async review(read, pick, closed) {
        if (!this.take())
            return null;
        try {
            const r = await this.client.beta.messages.parse({
                ...this.request(`${brief(read, closed)}\n\nO robô quer entrar agora em ${pick.direction} com expiração de ${pick.horizon} minutos, pelo gatilho "${pick.label}" (acerto medido ${pick.backtestWinRate == null ? "?" : (pick.backtestWinRate * 100).toFixed(1) + "%"} em ${pick.backtestTrades} testes; no próprio robô ${pick.liveWins}/${pick.liveTrades}).\nDecida ENTRAR ou PULAR, dê sua confiança de 0 a 100 e o motivo em uma ou duas frases.`),
                output_config: { effort: "low", format: betaZodOutputFormat(Review) },
            }, { timeout: 20000, maxRetries: 0 });
            if (r.stop_reason === "refusal")
                throw Error("A IA recusou esta análise");
            const out = r.parsed_output;
            if (!out)
                throw Error("Resposta da IA sem formato válido");
            this.lastError = null;
            return {
                enter: out.decisao === "ENTRAR",
                confidence: Math.max(0, Math.min(100, Math.round(out.confianca))),
                reason: out.motivo.trim(),
            };
        }
        catch (e) {
            this.lastError = e instanceof Error ? e.message : String(e);
            log.warn({ err: this.lastError }, "revisão da IA falhou");
            return null;
        }
    }
    // On-demand written analysis for the person looking at the chart.
    async explain(read, closed) {
        const hit = this.cache.get(read.symbol);
        if (hit && Date.now() - hit.at < 60000)
            return hit.text;
        if (!this.take())
            return null;
        try {
            const r = await this.client.beta.messages.create({
                ...this.request(`${brief(read, closed)}\n\nFaça a análise deste ativo para quem opera opções binárias de 1, 5 e 15 minutos (Ebinex). Em no máximo 6 linhas curtas: o que o preço está fazendo, onde estão as zonas importantes, se há entrada agora (compra, venda ou esperar) com qual expiração, e o que invalidaria a ideia. Sem markdown, uma ideia por linha.`),
                output_config: { effort: "low" },
            }, { timeout: 45000 });
            if (r.stop_reason === "refusal")
                throw Error("A IA recusou esta análise");
            const text = r.content
                .flatMap((b) => (b.type === "text" ? [b.text] : []))
                .join("\n")
                .trim();
            if (!text)
                throw Error("Resposta vazia da IA");
            this.lastError = null;
            this.cache.set(read.symbol, { at: Date.now(), text });
            return text;
        }
        catch (e) {
            this.lastError = e instanceof Error ? e.message : String(e);
            log.warn({ err: this.lastError }, "análise da IA falhou");
            return null;
        }
    }
}
