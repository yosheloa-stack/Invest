const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 16)) throw Error("Use Node.js 22.16+ ou 24+ (node:sqlite com backup)");
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL(".", import.meta.url)));
if (existsSync(".env")) loadEnvFile(".env");
for (const key of ["DASHBOARD_USER", "DASHBOARD_PASSWORD", "PUBLIC_ORIGIN"]) {
  if (!process.env[key]?.trim()) throw Error(`Configure ${key} nas variáveis da Square Cloud antes de iniciar`);
}
if (!process.env.PUBLIC_ORIGIN.startsWith("https://")) throw Error("PUBLIC_ORIGIN deve usar HTTPS");
if (process.env.DASHBOARD_PASSWORD.length < 16) throw Error("Use uma senha com pelo menos 16 caracteres");
if (!existsSync("dist/server.js") || !existsSync("public/index.html")) throw Error("Build ausente: execute npm ci && npm run build antes de empacotar");
process.env.PORT = "80";
process.env.NODE_ENV = "production";
await import("./dist/server.js");
