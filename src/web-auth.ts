import express, { type Express, type RequestHandler } from "express";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import { cookieToken, type Accounts, type User } from "./accounts.js";
const signupBody = z.object({
  name: z.string().trim().min(2).max(60),
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(128),
});
const loginBody = z.object({
  email: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(128),
});
export function originAllowed(req: IncomingMessage, publicOrigin: string) {
  if (!req.headers.origin) return true;
  try {
    const origin = new URL(req.headers.origin);
    return publicOrigin
      ? origin.origin === new URL(publicOrigin).origin
      : origin.host === req.headers.host;
  } catch {
    return false;
  }
}
// Login/sign-up endpoints plus the guards used by the API and the dashboard WebSocket.
export function mountAuth(
  app: Express,
  accounts: () => Accounts | null,
  opts: { publicOrigin: string; allowSignup: boolean },
) {
  const secure = opts.publicOrigin.startsWith("https:");
  const attempts = new Map<string, { n: number; reset: number }>();
  const limited = (ip: string) => {
    const now = Date.now(),
      a = attempts.get(ip);
    if (!a || a.reset < now) {
      attempts.set(ip, { n: 1, reset: now + 900000 });
      return false;
    }
    return ++a.n > 20;
  };
  const setCookie = (res: express.Response, token: string, maxAge: number) =>
    res.setHeader(
      "Set-Cookie",
      `yosh_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`,
    );
  const userOf = (req: IncomingMessage): User | null =>
    accounts()?.fromToken(cookieToken(req)) ?? null;
  const guard: RequestHandler = (req, res, next) => {
    if (req.method !== "GET" && !originAllowed(req, opts.publicOrigin)) {
      res.status(403).json({ error: "Origem não permitida" });
      return;
    }
    next();
  };
  const json = express.json({ limit: "10kb" });
  app.get("/api/auth/me", (req, res) => {
    const user = userOf(req);
    res.setHeader("Cache-Control", "no-store");
    if (!user)
      res
        .status(401)
        .json({ error: "Não autenticado", allowSignup: opts.allowSignup });
    else res.json({ user, allowSignup: opts.allowSignup });
  });
  app.post("/api/auth/signup", guard, json, (req, res) => {
    const acc = accounts();
    if (!acc)
      return void res
        .status(503)
        .json({ error: "Inicializando, tente em instantes" });
    if (!opts.allowSignup)
      return void res.status(403).json({ error: "Cadastro desativado" });
    if (limited(req.ip || ""))
      return void res.status(429).json({ error: "Muitas tentativas" });
    const body = signupBody.safeParse(req.body);
    if (!body.success)
      return void res.status(400).json({
        error:
          "Informe nome, e-mail válido e senha com pelo menos 8 caracteres",
      });
    try {
      const user = acc.signup(
          body.data.name,
          body.data.email,
          body.data.password,
        ),
        s = acc.createSession(user.id);
      setCookie(res, s.token, s.maxAge);
      res.json({ user });
    } catch (e) {
      res
        .status(409)
        .json({ error: e instanceof Error ? e.message : "Falha no cadastro" });
    }
  });
  app.post("/api/auth/login", guard, json, (req, res) => {
    const acc = accounts();
    if (!acc)
      return void res
        .status(503)
        .json({ error: "Inicializando, tente em instantes" });
    if (limited(req.ip || ""))
      return void res.status(429).json({ error: "Muitas tentativas" });
    const body = loginBody.safeParse(req.body);
    const user = body.success
      ? acc.login(body.data.email, body.data.password)
      : null;
    if (!user)
      return void res.status(401).json({ error: "E-mail ou senha incorretos" });
    const s = acc.createSession(user.id);
    setCookie(res, s.token, s.maxAge);
    res.json({ user });
  });
  app.post("/api/auth/logout", guard, (req, res) => {
    const token = cookieToken(req);
    if (token) accounts()?.destroy(token);
    setCookie(res, "", 0);
    res.json({ ok: true });
  });
  const requireUser: RequestHandler = (req, res, next) => {
    const user = userOf(req);
    if (!user) return void res.status(401).json({ error: "Faça login" });
    res.locals.user = user;
    res.setHeader("Cache-Control", "no-store");
    next();
  };
  const requireAdmin: RequestHandler = (req, res, next) =>
    (res.locals.user as User | undefined)?.role === "admin"
      ? next()
      : void res.status(403).json({ error: "Somente administrador" });
  const wsAuthorized = (req: IncomingMessage) =>
    Boolean(userOf(req)) && originAllowed(req, opts.publicOrigin);
  return { requireUser, requireAdmin, wsAuthorized };
}
