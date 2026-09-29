import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
// SQL is SQLite throughout. This wrapper binds numbered parameters and decodes JSON columns.
export class SQLiteConnection {
  readonly db: DatabaseSync;
  private lease?: DatabaseSync;
  constructor(
    readonly path: string,
    private onError: () => void = () => {},
  ) {
    if (path === ":memory:") throw Error("Use arquivo SQLite persistente");
    mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
    );
  }
  acquireCollector() {
    const lease = new DatabaseSync(this.path + ".collector-lock");
    try {
      lease.exec(
        "PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS owner(id INTEGER); BEGIN EXCLUSIVE;",
      );
      this.lease = lease;
    } catch {
      lease.close();
      throw Error("Outro coletor já controla este arquivo SQLite");
    }
  }
  exec(sql: string) {
    try {
      this.db.exec(sql);
    } catch (e) {
      this.onError();
      throw e;
    }
  }
  query(
    sql: string,
    args: unknown[] = [],
  ): { rows: Record<string, any>[]; rowCount: number } {
    try {
      const params: (string | number | null)[] = [];
      const text = sql.replace(/\$(\d+)/g, (_, index) => {
        const v = args[Number(index) - 1];
        params.push(
          v == null
            ? null
            : typeof v === "boolean"
              ? Number(v)
              : typeof v === "object"
                ? JSON.stringify(v)
                : (v as string | number),
        );
        return "?";
      });
      const statement = this.db.prepare(text);
      if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(text)) {
        const rows = statement.all(...params).map((raw) => {
          const row: Record<string, any> = { ...raw };
          for (const key of ["body", "features", "decision", "payload"])
            if (typeof row[key] === "string") row[key] = JSON.parse(row[key]);
          if (row.confirmed != null) row.confirmed = Boolean(row.confirmed);
          return row;
        });
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: Number(statement.run(...params).changes) };
    } catch (e) {
      this.onError();
      throw e;
    }
  }
  transaction(fn: () => void) {
    this.exec("BEGIN IMMEDIATE");
    try {
      fn();
      this.exec("COMMIT");
    } catch (e) {
      this.exec("ROLLBACK");
      throw e;
    }
  }
  async backupTo(path: string) {
    if (resolve(path) === resolve(this.path))
      throw Error("Backup deve usar outro arquivo");
    mkdirSync(dirname(resolve(path)), { recursive: true });
    await backup(this.db, path);
  }
  async end() {
    if (this.lease) {
      this.lease.close();
      this.lease = undefined;
    }
    this.db.close();
  }
}
