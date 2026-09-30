const TF = 5 * 60000;
// Closed 5-minute candles (only complete, gap-free windows).
export function toM5(closed) {
    const out = [];
    let cur = null;
    for (const c of closed) {
        const t = Math.floor(c.t / TF) * TF;
        if (!cur || cur.t !== t) {
            if (cur && cur.n === 5)
                out.push(cur);
            cur = { t, o: c.o, h: c.h, l: c.l, c: c.c, n: 1 };
        }
        else {
            cur.h = Math.max(cur.h, c.h);
            cur.l = Math.min(cur.l, c.l);
            cur.c = c.c;
            cur.n++;
        }
    }
    if (cur && cur.n === 5)
        out.push(cur);
    return out.map(({ t, o, h, l, c }) => ({ t, o, h, l, c }));
}
const body = (b) => Math.abs(b.c - b.o), range = (b) => b.h - b.l, upper = (b) => b.h - Math.max(b.o, b.c), lower = (b) => Math.min(b.o, b.c) - b.l, col = (b) => (b.c > b.o ? 1 : b.c < b.o ? -1 : 0), mid = (b) => (b.o + b.c) / 2;
// ---------- Candlestick patterns (last closed M5 candle and the ones before it) ----------
export function candlePatterns(bars) {
    const n = bars.length;
    if (n < 12)
        return [];
    const [b0, b1, b2] = [bars[n - 1], bars[n - 2], bars[n - 3]], avg = bars.slice(n - 11, n - 1).reduce((m, b) => m + body(b), 0) / 10, avgRange = bars.slice(n - 11, n - 1).reduce((m, b) => m + range(b), 0) / 10, 
    // Direction of the move that led here: close 1 bar back versus 6 bars back.
    prior = Math.sign(b1.c - bars[n - 7].c), big = (b) => body(b) >= Math.max(avg, range(b) * 0.5), small = (b) => body(b) <= Math.max(avg * 0.5, range(b) * 0.3), out = [];
    const hit = (id, name, bias, meaning, action, invalid) => out.push({
        kind: "candle",
        id,
        name,
        bias,
        status: "confirmado",
        meaning,
        action,
        level: bias === 1 ? b0.h : bias === -1 ? b0.l : null,
        target: null,
        invalid,
        distance: null,
        t: b0.t,
    });
    if (!(range(b0) > 0) || !(avgRange > 0))
        return out;
    if (body(b0) <= range(b0) * 0.1)
        hit("doji", "Doji", 0, "Abertura e fechamento quase iguais: compradores e vendedores empataram.", prior
            ? `Depois de ${prior === 1 ? "alta" : "queda"}, avisa que o movimento pode perder força. Espere a próxima vela confirmar.`
            : "Sem direção. Não entre só por ele.", null);
    const hammerShape = lower(b0) >= 2 * Math.max(body(b0), range(b0) * 0.05) &&
        upper(b0) <= range(b0) * 0.25, starShape = upper(b0) >= 2 * Math.max(body(b0), range(b0) * 0.05) &&
        lower(b0) <= range(b0) * 0.25;
    if (hammerShape && prior === -1)
        hit("martelo", "Martelo", 1, "Depois de queda, o preço caiu e voltou: pavio longo embaixo mostra compradores defendendo.", "Sinal de reversão para alta. Mais forte em suporte; confirma se a próxima vela fechar acima da máxima dele.", b0.l);
    if (hammerShape && prior === 1)
        hit("enforcado", "Enforcado", -1, "Mesmo formato do martelo, mas no topo de uma alta: apareceu venda forte durante a vela.", "Alerta de reversão para baixa. Confirma se a próxima vela fechar abaixo da mínima dele.", b0.h);
    if (starShape && prior === 1)
        hit("estrela-cadente", "Estrela cadente", -1, "Depois de alta, o preço subiu e foi rejeitado: pavio longo em cima.", "Sinal de reversão para baixa. Mais forte em resistência.", b0.h);
    if (starShape && prior === -1)
        hit("martelo-invertido", "Martelo invertido", 1, "Depois de queda, compradores tentaram subir o preço.", "Reversão fraca para alta: só vale com confirmação da próxima vela.", b0.l);
    if (col(b1) === -1 &&
        col(b0) === 1 &&
        b0.c >= b1.o &&
        b0.o <= b1.c &&
        body(b0) > body(b1))
        hit("engolfo-alta", "Engolfo de alta", 1, "Uma vela verde cobriu todo o corpo da vermelha anterior: compradores tomaram o controle.", prior === -1
            ? "Reversão para alta, principalmente em suporte."
            : "Continuação da alta.", Math.min(b0.l, b1.l));
    if (col(b1) === 1 &&
        col(b0) === -1 &&
        b0.c <= b1.o &&
        b0.o >= b1.c &&
        body(b0) > body(b1))
        hit("engolfo-baixa", "Engolfo de baixa", -1, "Uma vela vermelha cobriu todo o corpo da verde anterior: vendedores tomaram o controle.", prior === 1
            ? "Reversão para baixa, principalmente em resistência."
            : "Continuação da queda.", Math.max(b0.h, b1.h));
    const inside = Math.max(b0.o, b0.c) < Math.max(b1.o, b1.c) &&
        Math.min(b0.o, b0.c) > Math.min(b1.o, b1.c);
    if (big(b1) && small(b0) && inside && col(b1) === -1 && prior === -1)
        hit("harami-alta", "Harami de alta", 1, "Vela pequena dentro do corpo de uma vermelha grande: a queda perdeu força.", "Possível virada para alta; entre só se a próxima vela romper a máxima.", b1.l);
    if (big(b1) && small(b0) && inside && col(b1) === 1 && prior === 1)
        hit("harami-baixa", "Harami de baixa", -1, "Vela pequena dentro do corpo de uma verde grande: a alta perdeu força.", "Possível virada para baixa; entre só se a próxima vela romper a mínima.", b1.h);
    if (col(b1) === -1 &&
        big(b1) &&
        col(b0) === 1 &&
        b0.o <= b1.c &&
        b0.c > mid(b1) &&
        b0.c < b1.o)
        hit("perfuracao", "Linha de perfuração", 1, "Depois de uma vermelha forte, a verde fechou acima da metade dela.", "Reversão para alta de força média.", Math.min(b0.l, b1.l));
    if (col(b1) === 1 &&
        big(b1) &&
        col(b0) === -1 &&
        b0.o >= b1.c &&
        b0.c < mid(b1) &&
        b0.c > b1.o)
        hit("nuvem-negra", "Nuvem negra", -1, "Depois de uma verde forte, a vermelha fechou abaixo da metade dela.", "Reversão para baixa de força média.", Math.max(b0.h, b1.h));
    if (col(b2) === -1 && big(b2) && small(b1) && col(b0) === 1 && b0.c > mid(b2))
        hit("estrela-manha", "Estrela da manhã", 1, "Vermelha forte, vela pequena de indecisão e verde forte: a queda terminou.", "Uma das reversões de alta mais confiáveis.", Math.min(b0.l, b1.l, b2.l));
    if (col(b2) === 1 && big(b2) && small(b1) && col(b0) === -1 && b0.c < mid(b2))
        hit("estrela-noite", "Estrela da noite", -1, "Verde forte, vela pequena de indecisão e vermelha forte: a alta terminou.", "Uma das reversões de baixa mais confiáveis.", Math.max(b0.h, b1.h, b2.h));
    const three = [b2, b1, b0];
    if (three.every((b) => col(b) === 1 && body(b) >= range(b) * 0.6) &&
        b1.c > b2.c &&
        b0.c > b1.c)
        hit("tres-soldados", "Três soldados brancos", 1, "Três velas verdes fortes, cada uma fechando mais alto.", "Alta forte. Prefira comprar em recuo; no topo de uma resistência pode estar esticado.", b2.l);
    if (three.every((b) => col(b) === -1 && body(b) >= range(b) * 0.6) &&
        b1.c < b2.c &&
        b0.c < b1.c)
        hit("tres-corvos", "Três corvos negros", -1, "Três velas vermelhas fortes, cada uma fechando mais baixo.", "Queda forte. Prefira vender em repique; em suporte forte pode estar esticado.", b2.h);
    const tol = avgRange * 0.1;
    if (col(b1) === -1 &&
        col(b0) === 1 &&
        Math.abs(b0.l - b1.l) <= tol &&
        prior === -1)
        hit("pinca-fundo", "Pinça de fundo", 1, "Duas velas com a mesma mínima: o preço bateu duas vezes no mesmo piso.", "Reversão para alta se o piso segurar.", Math.min(b0.l, b1.l));
    if (col(b1) === 1 &&
        col(b0) === -1 &&
        Math.abs(b0.h - b1.h) <= tol &&
        prior === 1)
        hit("pinca-topo", "Pinça de topo", -1, "Duas velas com a mesma máxima: o preço bateu duas vezes no mesmo teto.", "Reversão para baixa se o teto segurar.", Math.max(b0.h, b1.h));
    if (body(b0) >= range(b0) * 0.9 && body(b0) >= 1.5 * avg)
        hit("marubozu", col(b0) === 1 ? "Marubozu de alta" : "Marubozu de baixa", col(b0), "Vela cheia, quase sem pavio: um lado dominou do começo ao fim.", "Sinal de continuação na direção da vela.", col(b0) === 1 ? b0.l : b0.h);
    if (b0.h < b1.h && b0.l > b1.l)
        out.push({
            kind: "candle",
            id: "inside-bar",
            name: "Inside bar",
            bias: 0,
            status: "formando",
            meaning: "A vela ficou inteira dentro da anterior: o mercado está comprimindo.",
            action: `Rompimento pendente: acima de ${fmt(b1.h)} tende a subir, abaixo de ${fmt(b1.l)} tende a cair.`,
            level: b1.h,
            target: null,
            invalid: b1.l,
            distance: null,
            t: b0.t,
        });
    return out;
}
const fmt = (n) => n.toLocaleString("pt-BR", {
    maximumFractionDigits: n >= 1000 ? 2 : n >= 1 ? 4 : 6,
});
function pivots(bars, k = 2) {
    const hi = [], lo = [];
    for (let j = k; j < bars.length - k; j++) {
        let isHi = true, isLo = true;
        for (let d = 1; d <= k; d++) {
            if (bars[j - d].h > bars[j].h || bars[j + d].h >= bars[j].h)
                isHi = false;
            if (bars[j - d].l < bars[j].l || bars[j + d].l <= bars[j].l)
                isLo = false;
        }
        if (isHi)
            hi.push({ i: j, p: bars[j].h });
        if (isLo)
            lo.push({ i: j, p: bars[j].l });
    }
    return { hi, lo };
}
// Least-squares line through pivots; value at bar x.
function line(ps) {
    const n = ps.length, sx = ps.reduce((m, p) => m + p.i, 0), sy = ps.reduce((m, p) => m + p.p, 0), sxx = ps.reduce((m, p) => m + p.i * p.i, 0), sxy = ps.reduce((m, p) => m + p.i * p.p, 0), den = n * sxx - sx * sx, slope = den ? (n * sxy - sx * sy) / den : 0, icpt = (sy - slope * sx) / n;
    return { slope, at: (x) => icpt + slope * x };
}
export function chartPatterns(bars) {
    const n = bars.length;
    if (n < 30)
        return [];
    const view = bars.slice(-80), last = view.length - 1, close = view[last].c, unit = view.slice(-20).reduce((m, b) => m + range(b), 0) /
        Math.min(20, view.length);
    if (!(unit > 0))
        return [];
    const { hi, lo } = pivots(view), out = [], tol = unit * 0.6, t = bars[n - 1].t;
    const push = (id, name, bias, level, height, invalid, meaning, action) => {
        const broke = bias === 1 ? close > level : bias === -1 ? close < level : false;
        out.push({
            kind: "grafico",
            id,
            name,
            bias,
            status: broke ? "rompeu" : "formando",
            meaning,
            action,
            level,
            target: bias ? level + bias * height : null,
            invalid,
            distance: Math.abs(close - level) / unit,
            t,
        });
    };
    // Double top / bottom: two similar extremes with a pullback between them.
    const [h1, h2] = hi.slice(-2), [l1, l2] = lo.slice(-2);
    if (h1 && h2 && Math.abs(h1.p - h2.p) <= tol && h2.i - h1.i >= 4) {
        const neck = Math.min(...view.slice(h1.i, h2.i + 1).map((b) => b.l)), top = Math.max(h1.p, h2.p);
        if (top - neck > 2 * unit && close < top && close > neck - 3 * unit)
            push("topo-duplo", "Topo duplo", -1, neck, top - neck, top, "O preço tentou passar do mesmo topo duas vezes e não conseguiu.", `Vende quando fechar abaixo da linha do pescoço (${fmt(neck)}). Alvo: a altura do padrão para baixo. Perde a validade se passar de ${fmt(top)}.`);
    }
    if (l1 && l2 && Math.abs(l1.p - l2.p) <= tol && l2.i - l1.i >= 4) {
        const neck = Math.max(...view.slice(l1.i, l2.i + 1).map((b) => b.h)), bottom = Math.min(l1.p, l2.p);
        if (neck - bottom > 2 * unit && close > bottom && close < neck + 3 * unit)
            push("fundo-duplo", "Fundo duplo", 1, neck, neck - bottom, bottom, "O preço bateu duas vezes no mesmo fundo e voltou.", `Compra quando fechar acima da linha do pescoço (${fmt(neck)}). Alvo: a altura do padrão para cima. Perde a validade se cair abaixo de ${fmt(bottom)}.`);
    }
    // Head and shoulders: three highs, the middle one highest, shoulders similar.
    const H = hi.slice(-3);
    if (H.length === 3) {
        const [a, b, c] = H;
        if (b.p > a.p + tol &&
            b.p > c.p + tol &&
            Math.abs(a.p - c.p) <= tol * 1.5) {
            const n1 = Math.min(...view.slice(a.i, b.i + 1).map((x) => x.l)), n2 = Math.min(...view.slice(b.i, c.i + 1).map((x) => x.l)), neck = Math.max(n1, n2);
            if (close > neck - 3 * unit)
                push("oco", "Ombro-cabeça-ombro (OCO)", -1, neck, b.p - neck, c.p, "Três topos, o do meio mais alto: a alta está perdendo força.", `Vende no fechamento abaixo do pescoço (${fmt(neck)}). Alvo: a altura da cabeça até o pescoço. Invalida acima do ombro direito (${fmt(c.p)}).`);
        }
    }
    const L = lo.slice(-3);
    if (L.length === 3) {
        const [a, b, c] = L;
        if (b.p < a.p - tol &&
            b.p < c.p - tol &&
            Math.abs(a.p - c.p) <= tol * 1.5) {
            const n1 = Math.max(...view.slice(a.i, b.i + 1).map((x) => x.h)), n2 = Math.max(...view.slice(b.i, c.i + 1).map((x) => x.h)), neck = Math.min(n1, n2);
            if (close < neck + 3 * unit)
                push("oco-invertido", "OCO invertido", 1, neck, neck - b.p, c.p, "Três fundos, o do meio mais baixo: a queda está perdendo força.", `Compra no fechamento acima do pescoço (${fmt(neck)}). Alvo: a altura da cabeça até o pescoço. Invalida abaixo do ombro direito (${fmt(c.p)}).`);
        }
    }
    // Triangles, wedges, rectangles and flags from lines through the last 3 highs and lows.
    const hs = hi.slice(-3), ls = lo.slice(-3);
    if (hs.length >= 2 && ls.length >= 2) {
        const start = Math.min(hs[0].i, ls[0].i), top = line(hs), bot = line(ls), upNow = top.at(last), dnNow = bot.at(last), height0 = top.at(start) - bot.at(start), flat = unit * 0.04, sT = top.slope, sB = bot.slope;
        // The price must still be inside (or just out of) the lines, and they must not have crossed.
        if (upNow > dnNow &&
            close < upNow + 3 * unit &&
            close > dnNow - 3 * unit &&
            last - start >= 8) {
            const converging = height0 > (upNow - dnNow) * 1.25, poleFrom = Math.max(0, start - 8), pole = view[start].c - view[poleFrom].c, height = Math.max(height0, upNow - dnNow);
            const up = (name, id, meaning) => push(id, name, 1, upNow, height, dnNow, meaning, `Compra quando fechar acima da linha de cima (${fmt(upNow)}). Alvo: a altura do padrão. Invalida abaixo de ${fmt(dnNow)}.`), down = (name, id, meaning) => push(id, name, -1, dnNow, height, upNow, meaning, `Vende quando fechar abaixo da linha de baixo (${fmt(dnNow)}). Alvo: a altura do padrão. Invalida acima de ${fmt(upNow)}.`);
            if (Math.abs(pole) > 2.5 * (upNow - dnNow) &&
                !converging &&
                Math.sign(sT) !== Math.sign(pole) &&
                Math.abs(sT - sB) < flat * 2) {
                if (pole > 0)
                    up("Bandeira de alta", "bandeira-alta", "Subida forte (o mastro) seguida de um canal pequeno descendo: pausa para continuar subindo.");
                else
                    down("Bandeira de baixa", "bandeira-baixa", "Queda forte (o mastro) seguida de um canal pequeno subindo: pausa para continuar caindo.");
            }
            else if (Math.abs(sT) <= flat && sB > flat && converging)
                up("Triângulo ascendente", "triangulo-ascendente", "Teto reto e fundos cada vez mais altos: compradores apertando a resistência.");
            else if (sT < -flat && Math.abs(sB) <= flat && converging)
                down("Triângulo descendente", "triangulo-descendente", "Piso reto e topos cada vez mais baixos: vendedores apertando o suporte.");
            else if (sT < -flat && sB > flat && converging) {
                const trend = Math.sign(pole);
                if (trend >= 0)
                    up("Triângulo simétrico", "triangulo-simetrico", "Topos descendo e fundos subindo: o preço está comprimindo. Costuma romper a favor da tendência anterior (alta).");
                else
                    down("Triângulo simétrico", "triangulo-simetrico", "Topos descendo e fundos subindo: o preço está comprimindo. Costuma romper a favor da tendência anterior (baixa).");
            }
            else if (sT > flat && sB > flat && sB > sT && converging)
                down("Cunha ascendente", "cunha-ascendente", "Topos e fundos subindo, mas cada vez mais apertados: a alta está cansando. Costuma romper para baixo.");
            else if (sT < -flat && sB < -flat && sT < sB && converging)
                up("Cunha descendente", "cunha-descendente", "Topos e fundos caindo, mas cada vez mais apertados: a queda está cansando. Costuma romper para cima.");
            else if (Math.abs(sT) <= flat && Math.abs(sB) <= flat) {
                const nearTop = upNow - close < close - dnNow;
                out.push({
                    kind: "grafico",
                    id: "retangulo",
                    name: "Retângulo (lateral)",
                    bias: 0,
                    status: close > upNow ? "rompeu" : close < dnNow ? "rompeu" : "formando",
                    meaning: "Teto e piso retos: o mercado está andando de lado.",
                    action: `Dentro da faixa, vende perto de ${fmt(upNow)} e compra perto de ${fmt(dnNow)}. Fechamento fora da faixa vira rompimento.`,
                    level: nearTop ? upNow : dnNow,
                    target: nearTop ? upNow + (upNow - dnNow) : dnNow - (upNow - dnNow),
                    invalid: nearTop ? dnNow : upNow,
                    distance: Math.abs(close - (nearTop ? upNow : dnNow)) / unit,
                    t,
                });
            }
        }
    }
    return out;
}
// Everything for one asset: candle patterns on the last M5 candle and the chart patterns in play.
export function readPatterns(closed) {
    const bars = toM5(closed.slice(-1500));
    return { candles: candlePatterns(bars), charts: chartPatterns(bars) };
}
