import { log } from "../log.js";
const HOSTS = ["qxbroker.com", "quotex.com", "quotex.io"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
let _gotScraping = null;
async function getGot() {
    if (_gotScraping)
        return _gotScraping;
    const mod = await import("got-scraping");
    _gotScraping = mod.gotScraping;
    log.info("quotex: got-scraping loaded (Chrome TLS fingerprint)");
    return _gotScraping;
}
function extractSetCookies(headers) {
    const jar = new Map();
    const raw = headers["set-cookie"];
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const c of list) {
        const eq = c.indexOf("=");
        const semi = c.indexOf(";");
        if (eq > 0) {
            jar.set(c.slice(0, eq).trim(), c.slice(eq + 1, semi > 0 ? semi : undefined).trim());
        }
    }
    return jar;
}
function extractCookies(headers) {
    const jar = new Map();
    for (const c of headers.getSetCookie?.() ?? []) {
        const eq = c.indexOf("=");
        const semi = c.indexOf(";");
        if (eq > 0) {
            jar.set(c.slice(0, eq).trim(), c.slice(eq + 1, semi > 0 ? semi : undefined).trim());
        }
    }
    return jar;
}
function cookieString(jar) {
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
function navHeaders(host, referer) {
    return {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Upgrade-Insecure-Requests": "1",
        "Cache-Control": "max-age=0",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": referer ? "same-origin" : "none",
        "Sec-Fetch-User": "?1",
        "Sec-CH-UA": '"Chromium";v="131", "Not_A Brand";v="24"',
        "Sec-CH-UA-Mobile": "?0",
        "Sec-CH-UA-Platform": '"Windows"',
        ...(referer ? { Referer: referer } : {}),
    };
}
function formHeaders(host, referer) {
    return {
        ...navHeaders(host, referer),
        Origin: `https://${host}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Sec-Fetch-Dest": "iframe",
    };
}
function findToken(html) {
    return html.match(/name="_token"\s+value="([^"]+)"/)?.[1] ?? null;
}
function findSettingsToken(html) {
    const m = html.match(/window\.settings\s*=\s*(\{[^;]+\})/);
    if (!m)
        return null;
    try {
        return JSON.parse(m[1]).token || null;
    }
    catch {
        return null;
    }
}
function isCfChallenge(body, headers) {
    if (headers["cf-mitigated"] === "challenge")
        return true;
    if (body.includes("Just a moment") && body.includes("cf-"))
        return true;
    return false;
}
export async function loginHttp(email, password, preferredHost) {
    const hosts = preferredHost
        ? [preferredHost, ...HOSTS.filter((h) => h !== preferredHost)]
        : HOSTS;
    // Try got-scraping (Chrome TLS fingerprint)
    try {
        const got = await getGot();
        for (const host of hosts) {
            log.info({ host }, "quotex: attempting login (got-scraping chrome120)");
            try {
                const result = await tryLoginGot(got, host, email, password);
                if (result)
                    return result;
            }
            catch (err) {
                log.warn({ host, err: err.message }, "quotex: got-scraping login error");
            }
        }
    }
    catch {
        log.warn("quotex: got-scraping not available");
    }
    // Fallback: native fetch
    for (const host of hosts) {
        log.info({ host }, "quotex: attempting login (fetch)");
        try {
            const result = await tryLoginFetch(host, email, password);
            if (result)
                return result;
        }
        catch (err) {
            log.warn({ host, err: err.message }, "quotex: fetch login error");
        }
    }
    return null;
}
async function tryLoginGot(got, host, email, password) {
    const base = `https://${host}`;
    const jar = new Map();
    const gen = { browsers: [{ name: "chrome", minVersion: 120 }], operatingSystems: ["windows"] };
    // Let got-scraping handle header generation for best fingerprint match
    const r1 = await got(`${base}/pt/sign-in`, {
        followRedirect: false,
        headerGeneratorOptions: gen,
        headers: { "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7" },
    });
    for (const [k, v] of extractSetCookies(r1.headers))
        jar.set(k, v);
    log.info({ host, status: r1.statusCode, cfChallenge: isCfChallenge(r1.body, r1.headers), bodyLen: r1.body.length }, "quotex: sign-in page response");
    if (isCfChallenge(r1.body, r1.headers)) {
        log.warn({ host }, "quotex: Cloudflare challenge detected — datacenter IP blocked");
        return null;
    }
    let token = findToken(r1.body);
    if (!token) {
        const r2 = await got(`${base}/sign-in/modal/`, {
            headers: { ...navHeaders(host, `${base}/pt/sign-in`), Cookie: cookieString(jar) },
            followRedirect: false,
            headerGeneratorOptions: gen,
        });
        for (const [k, v] of extractSetCookies(r2.headers))
            jar.set(k, v);
        token = findToken(r2.body);
        if (!token && isCfChallenge(r2.body, r2.headers)) {
            log.warn({ host }, "quotex: Cloudflare challenge on modal endpoint");
            return null;
        }
    }
    if (!token) {
        log.warn({ host, snippet: r1.body.slice(0, 300) }, "quotex: CSRF token not found (got-scraping)");
        return null;
    }
    log.info({ host }, "quotex: CSRF token obtained");
    const body = new URLSearchParams({ _token: token, email, password, remember: "1" });
    const r3 = await got(`${base}/sign-in`, {
        method: "POST",
        headers: { ...formHeaders(host, `${base}/pt/sign-in`), Cookie: cookieString(jar) },
        body: body.toString(),
        followRedirect: false,
        headerGeneratorOptions: gen,
    });
    for (const [k, v] of extractSetCookies(r3.headers))
        jar.set(k, v);
    let tradeHtml = r3.body;
    let location = typeof r3.headers.location === "string" ? r3.headers.location : null;
    for (let i = 0; i < 5 && location; i++) {
        const url = location.startsWith("http") ? location : `${base}${location}`;
        const rn = await got(url, {
            headers: { ...navHeaders(host, `${base}/pt/sign-in`), Cookie: cookieString(jar) },
            followRedirect: false,
            headerGeneratorOptions: gen,
        });
        for (const [k, v] of extractSetCookies(rn.headers))
            jar.set(k, v);
        tradeHtml = rn.body;
        location = typeof rn.headers.location === "string" ? rn.headers.location : null;
    }
    let ssid = findSettingsToken(tradeHtml);
    if (!ssid) {
        try {
            const rd = await got(`${base}/api/v1/cabinets/digest`, {
                headers: { ...navHeaders(host, `${base}/pt`), Cookie: cookieString(jar), Accept: "application/json" },
                headerGeneratorOptions: gen,
            });
            ssid = JSON.parse(rd.body)?.data?.token || null;
        }
        catch { /* ignore */ }
    }
    if (!ssid) {
        log.warn({ host }, "quotex: SSID not found after login (got-scraping)");
        return null;
    }
    log.info({ host }, "quotex: login successful (got-scraping)");
    return { ssid, cookies: cookieString(jar), userAgent: UA, host };
}
async function tryLoginFetch(host, email, password) {
    const base = `https://${host}`;
    const jar = new Map();
    const r1 = await fetch(`${base}/pt/sign-in`, { headers: navHeaders(host), redirect: "manual" });
    for (const [k, v] of extractCookies(r1.headers))
        jar.set(k, v);
    const html1 = await r1.text();
    if (html1.includes("Just a moment")) {
        log.warn({ host }, "quotex: Cloudflare challenge (fetch)");
        return null;
    }
    let token = findToken(html1);
    if (!token) {
        const r2 = await fetch(`${base}/sign-in/modal/`, {
            headers: { ...navHeaders(host, `${base}/pt/sign-in`), Cookie: cookieString(jar) },
        });
        for (const [k, v] of extractCookies(r2.headers))
            jar.set(k, v);
        token = findToken(await r2.text());
    }
    if (!token) {
        log.warn({ host }, "quotex: CSRF token not found (fetch)");
        return null;
    }
    const body = new URLSearchParams({ _token: token, email, password, remember: "1" });
    const r3 = await fetch(`${base}/sign-in`, {
        method: "POST",
        headers: { ...formHeaders(host, `${base}/pt/sign-in`), Cookie: cookieString(jar) },
        body: body.toString(),
        redirect: "manual",
    });
    for (const [k, v] of extractCookies(r3.headers))
        jar.set(k, v);
    let location = r3.headers.get("location");
    let tradeHtml = location ? "" : await r3.text();
    for (let i = 0; i < 5 && location; i++) {
        const url = location.startsWith("http") ? location : `${base}${location}`;
        const rn = await fetch(url, {
            headers: { ...navHeaders(host, `${base}/pt`), Cookie: cookieString(jar) },
            redirect: "manual",
        });
        for (const [k, v] of extractCookies(rn.headers))
            jar.set(k, v);
        tradeHtml = await rn.text();
        location = rn.headers.get("location");
    }
    let ssid = findSettingsToken(tradeHtml);
    if (!ssid) {
        try {
            const rd = await fetch(`${base}/api/v1/cabinets/digest`, {
                headers: { ...navHeaders(host, `${base}/pt`), Cookie: cookieString(jar), Accept: "application/json" },
            });
            if (rd.ok)
                ssid = (await rd.json())?.data?.token || null;
        }
        catch { /* ignore */ }
    }
    if (!ssid) {
        log.warn({ host }, "quotex: SSID not found (fetch)");
        return null;
    }
    log.info({ host }, "quotex: login successful (fetch)");
    return { ssid, cookies: cookieString(jar), userAgent: UA, host };
}
export function manualSsid(ssid, host = "qxbroker.com") {
    return { ssid, cookies: "", userAgent: UA, host };
}
