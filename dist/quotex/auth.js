import { log } from "../log.js";
const HOSTS = ["qxbroker.com", "quotex.com", "quotex.io"];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
function browserHeaders(host, referer) {
    return {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": referer ? "same-origin" : "none",
        "Sec-Fetch-User": "?1",
        "Sec-CH-UA": '"Chromium";v="131", "Not_A Brand";v="24"',
        "Sec-CH-UA-Mobile": "?0",
        "Sec-CH-UA-Platform": '"Windows"',
        Origin: `https://${host}`,
        ...(referer ? { Referer: referer } : {}),
    };
}
function extractCookies(headers) {
    const jar = new Map();
    const raw = headers.getSetCookie?.() ?? [];
    for (const c of raw) {
        const eq = c.indexOf("=");
        const semi = c.indexOf(";");
        if (eq > 0) {
            const name = c.slice(0, eq).trim();
            const val = c.slice(eq + 1, semi > 0 ? semi : undefined).trim();
            jar.set(name, val);
        }
    }
    return jar;
}
function cookieString(jar) {
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
function findToken(html) {
    const m = html.match(/name="_token"\s+value="([^"]+)"/);
    return m ? m[1] : null;
}
function findSettingsToken(html) {
    const m = html.match(/window\.settings\s*=\s*(\{[^;]+\})/);
    if (!m)
        return null;
    try {
        const obj = JSON.parse(m[1]);
        return obj.token || null;
    }
    catch {
        return null;
    }
}
export async function loginHttp(email, password, preferredHost) {
    const hosts = preferredHost
        ? [preferredHost, ...HOSTS.filter((h) => h !== preferredHost)]
        : HOSTS;
    for (const host of hosts) {
        log.info({ host }, "quotex: attempting login");
        try {
            const result = await tryLogin(host, email, password);
            if (result)
                return result;
        }
        catch (err) {
            log.warn({ host, err: err.message }, "quotex: login failed on host");
        }
    }
    return null;
}
async function tryLogin(host, email, password) {
    const base = `https://${host}`;
    const jar = new Map();
    // Step 1: load the sign-in page and collect cookies
    const r1 = await fetch(`${base}/pt/sign-in`, {
        headers: browserHeaders(host),
        redirect: "manual",
    });
    for (const [k, v] of extractCookies(r1.headers))
        jar.set(k, v);
    const html1 = await r1.text();
    // Step 2: get CSRF token
    let token = findToken(html1);
    if (!token) {
        // Try the modal endpoint
        const r2 = await fetch(`${base}/sign-in/modal/`, {
            headers: { ...browserHeaders(host, `${base}/pt/sign-in`), Cookie: cookieString(jar) },
        });
        for (const [k, v] of extractCookies(r2.headers))
            jar.set(k, v);
        const html2 = await r2.text();
        token = findToken(html2);
    }
    if (!token) {
        log.warn({ host }, "quotex: CSRF token not found");
        return null;
    }
    // Step 3: POST login
    const body = new URLSearchParams({
        _token: token,
        email,
        password,
        remember: "1",
    });
    const r3 = await fetch(`${base}/sign-in`, {
        method: "POST",
        headers: {
            ...browserHeaders(host, `${base}/pt/sign-in`),
            Cookie: cookieString(jar),
            "Content-Type": "application/x-www-form-urlencoded",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
        },
        body: body.toString(),
        redirect: "manual",
    });
    for (const [k, v] of extractCookies(r3.headers))
        jar.set(k, v);
    // Follow redirects manually to collect cookies
    let location = r3.headers.get("location");
    let tradeHtml = "";
    if (location) {
        if (!location.startsWith("http"))
            location = `${base}${location}`;
        const r4 = await fetch(location, {
            headers: { ...browserHeaders(host, `${base}/pt/sign-in`), Cookie: cookieString(jar) },
            redirect: "manual",
        });
        for (const [k, v] of extractCookies(r4.headers))
            jar.set(k, v);
        tradeHtml = await r4.text();
        // Another redirect?
        const loc2 = r4.headers.get("location");
        if (loc2) {
            const full = loc2.startsWith("http") ? loc2 : `${base}${loc2}`;
            const r5 = await fetch(full, {
                headers: { ...browserHeaders(host, `${base}/pt`), Cookie: cookieString(jar) },
                redirect: "manual",
            });
            for (const [k, v] of extractCookies(r5.headers))
                jar.set(k, v);
            tradeHtml = await r5.text();
        }
    }
    else {
        tradeHtml = await r3.text();
    }
    // Step 4: extract SSID from window.settings
    let ssid = findSettingsToken(tradeHtml);
    if (!ssid) {
        // Try the digest API
        try {
            const r6 = await fetch(`${base}/api/v1/cabinets/digest`, {
                headers: {
                    ...browserHeaders(host, `${base}/pt`),
                    Cookie: cookieString(jar),
                    Accept: "application/json",
                },
            });
            if (r6.ok) {
                const digest = (await r6.json());
                ssid = digest?.data?.token || null;
            }
        }
        catch {
            // ignore
        }
    }
    if (!ssid) {
        log.warn({ host }, "quotex: SSID not found after login");
        return null;
    }
    log.info({ host }, "quotex: login successful");
    return { ssid, cookies: cookieString(jar), userAgent: UA, host };
}
/** Use a pre-existing SSID token (from manual extraction or saved session). */
export function manualSsid(ssid, host = "qxbroker.com") {
    return { ssid, cookies: "", userAgent: UA, host };
}
