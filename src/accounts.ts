import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { SQLiteConnection } from "./database.js";
export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
}
const SESSION_MS = 30 * 86400000;
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, stored: string) {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const a = scryptSync(password, Buffer.from(salt, "hex"), 64),
    b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
export function cookieToken(req: IncomingMessage) {
  return req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("yosh_session="))
    ?.slice(13);
}
// Accounts and sessions live in the same SQLite file; only token hashes are stored.
export class Accounts {
  constructor(private db: SQLiteConnection) {}
  // The DASHBOARD_USER/PASSWORD pair stays valid as the admin login.
  seedAdmin(user: string, password: string) {
    if (!user || !password) return;
    const email = user.toLowerCase();
    const found = this.db.query(
      "SELECT id,password FROM users WHERE email=$1",
      [email],
    ).rows[0];
    if (!found)
      this.db.query(
        "INSERT INTO users(id,email,name,password,role,created_at) VALUES($1,$2,$3,$4,'admin',$5)",
        [randomUUID(), email, user, hashPassword(password), Date.now()],
      );
    else if (!verifyPassword(password, found.password))
      this.db.query("UPDATE users SET password=$1,role='admin' WHERE id=$2", [
        hashPassword(password),
        found.id,
      ]);
  }
  signup(name: string, email: string, password: string): User {
    email = email.trim().toLowerCase();
    if (this.db.query("SELECT 1 FROM users WHERE email=$1", [email]).rowCount)
      throw Error("E-mail já cadastrado");
    const user: User = {
      id: randomUUID(),
      email,
      name: name.trim(),
      role: "user",
    };
    this.db.query(
      "INSERT INTO users(id,email,name,password,role,created_at) VALUES($1,$2,$3,$4,'user',$5)",
      [user.id, email, user.name, hashPassword(password), Date.now()],
    );
    return user;
  }
  login(email: string, password: string): User | null {
    const row = this.db.query(
      "SELECT id,email,name,role,password FROM users WHERE email=$1",
      [email.trim().toLowerCase()],
    ).rows[0];
    // Hash even for unknown users so response time does not reveal registered e-mails.
    if (!row) {
      verifyPassword(password, "scrypt$00$00");
      hashPassword(password);
      return null;
    }
    if (!verifyPassword(password, row.password)) return null;
    return { id: row.id, email: row.email, name: row.name, role: row.role };
  }
  createSession(userId: string) {
    const token = randomBytes(32).toString("base64url");
    this.db.query("DELETE FROM sessions WHERE expires<$1", [Date.now()]);
    this.db.query(
      "INSERT INTO sessions(token_hash,user_id,expires) VALUES($1,$2,$3)",
      [hashToken(token), userId, Date.now() + SESSION_MS],
    );
    return { token, maxAge: SESSION_MS / 1000 };
  }
  destroy(token: string) {
    this.db.query("DELETE FROM sessions WHERE token_hash=$1", [
      hashToken(token),
    ]);
  }
  fromToken(token: string | undefined): User | null {
    if (!token) return null;
    const row = this.db.query(
      "SELECT u.id,u.email,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires>$2",
      [hashToken(token), Date.now()],
    ).rows[0];
    return row
      ? { id: row.id, email: row.email, name: row.name, role: row.role }
      : null;
  }
  count() {
    return Number(this.db.query("SELECT count(*) AS n FROM users").rows[0].n);
  }
}
