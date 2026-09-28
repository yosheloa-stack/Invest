import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { RequestHandler } from "express";
export function dashboardAuth(user: string, password: string, publicOrigin = "") {
  if (Boolean(user) !== Boolean(password)) throw Error("Configure usuário e senha juntos");
  const enabled = Boolean(user && password);
  const secret = randomBytes(32);
  const digest = (s: string) => createHash("sha256").update(s).digest();
  const equal = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));
  const sign = (s: string) => createHmac("sha256", secret).update(s).digest("hex");
  const basic = (req: IncomingMessage) => {
    const value = req.headers.authorization;
    return Boolean(value?.startsWith("Basic ") && equal(Buffer.from(value.slice(6), "base64").toString(), `${user}:${password}`));
  };
  const authorized = (req: IncomingMessage) => {
    if (!enabled || basic(req)) return true;
    const token = req.headers.cookie?.split(";").map(s => s.trim()).find(s => s.startsWith("scanner_session="))?.slice(16);
    if (!token) return false;
    const [expires, signature] = token.split(".");
    return Number(expires) > Date.now() && Boolean(signature) && equal(signature!, sign(expires!));
  };
  const originAllowed = (req: IncomingMessage) => {
    if (!req.headers.origin) return true;
    try {
      const origin = new URL(req.headers.origin);
      return publicOrigin ? origin.origin === new URL(publicOrigin).origin : origin.host === req.headers.host;
    } catch { return false; }
  };
  const middleware: RequestHandler = (req, res, next) => {
    if (!authorized(req)) {
      res.setHeader("WWW-Authenticate", 'Basic realm="Yosh Scanner", charset="UTF-8"');
      res.status(401).send("Autenticação necessária"); return;
    }
    if (enabled && basic(req)) {
      const expires = String(Date.now() + 12 * 3600000);
      res.setHeader("Set-Cookie", `scanner_session=${expires}.${sign(expires)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${publicOrigin.startsWith("https:") ? "; Secure" : ""}`);
    }
    res.setHeader("Cache-Control", "no-store");
    next();
  };
  return { middleware, authorized, originAllowed };
}
