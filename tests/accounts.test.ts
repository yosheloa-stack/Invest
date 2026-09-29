import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { Store } from "../src/store.js";
import { Accounts } from "../src/accounts.js";
import { mountAuth } from "../src/web-auth.js";
test("cadastro, login, sessão, API protegida, admin e WebSocket com origem", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scanner-accounts-"));
  const store = new Store(join(dir, "scanner.sqlite"));
  await store.init();
  const accounts = new Accounts(store.pool);
  accounts.seedAdmin("yosh", "long-admin-password");
  const app = express();
  const auth = mountAuth(app, () => accounts, {
    publicOrigin: "https://scanner.example",
    allowSignup: true,
  });
  app.use("/api", auth.requireUser);
  app.get("/api/data", (_req, res) => res.json({ ok: true }));
  app.get("/api/admin", auth.requireAdmin, (_req, res) =>
    res.json({ ok: true }),
  );
  const server = createServer(app),
    wss = new WebSocketServer({
      server,
      verifyClient: ({ req }: { req: import("node:http").IncomingMessage }) =>
        auth.wsAuthorized(req),
    });
  wss.on("connection", (ws) => ws.send("connected"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (
    path: string,
    body: unknown,
    origin = "https://scanner.example",
  ) =>
    fetch(url + path, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await fetch(url + "/api/data")).status, 401);
    assert.equal(
      (
        await post("/api/auth/signup", {
          name: "Ana",
          email: "ana@x.com",
          password: "123",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          "/api/auth/signup",
          { name: "Ana", email: "ana@x.com", password: "senha-forte-1" },
          "https://evil.example",
        )
      ).status,
      403,
    );
    const signup = await post("/api/auth/signup", {
      name: "Ana",
      email: "Ana@X.com",
      password: "senha-forte-1",
    });
    assert.equal(signup.status, 200);
    const cookie = signup.headers.get("set-cookie")!.split(";")[0]!;
    assert.equal(
      (await fetch(url + "/api/data", { headers: { cookie } })).status,
      200,
    );
    assert.equal(
      (await fetch(url + "/api/admin", { headers: { cookie } })).status,
      403,
    );
    assert.equal(
      (
        await post("/api/auth/signup", {
          name: "Ana 2",
          email: "ana@x.com",
          password: "outra-senha-1",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await post("/api/auth/login", {
          email: "ana@x.com",
          password: "errada",
        })
      ).status,
      401,
    );
    const admin = await post("/api/auth/login", {
      email: "yosh",
      password: "long-admin-password",
    });
    const adminCookie = admin.headers.get("set-cookie")!.split(";")[0]!;
    assert.equal(
      (await fetch(url + "/api/admin", { headers: { cookie: adminCookie } }))
        .status,
      200,
    );
    const ws = new WebSocket(url.replace("http:", "ws:"), {
      headers: { cookie, origin: "https://scanner.example" },
    });
    const [msg] = await once(ws, "message");
    assert.equal(String(msg), "connected");
    ws.close();
    await once(ws, "close");
    const bad = new WebSocket(url.replace("http:", "ws:"), {
      headers: { cookie, origin: "https://attacker.example" },
    });
    const [err] = await once(bad, "error");
    assert.match(String(err), /401/);
    await fetch(url + "/api/auth/logout", {
      method: "POST",
      headers: { cookie },
    });
    assert.equal(
      (await fetch(url + "/api/data", { headers: { cookie } })).status,
      401,
    );
  } finally {
    wss.close();
    server.closeAllConnections();
    server.close();
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
