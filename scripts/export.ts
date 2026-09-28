import { SQLiteConnection } from "../src/database.js";
import { writeFile } from "node:fs/promises";
import { config } from "../src/config.js";
import { FEATURE_NAMES, FEATURE_VERSION } from "../src/features.js";
const pool = new SQLiteConnection(config.SQLITE_PATH);
try {
  const rows = (
    await pool.query(
      "SELECT symbol,horizon,t,due,final_t,features,return,label FROM observations WHERE status='SETTLED' ORDER BY t,symbol,horizon",
    )
  ).rows;
  const snapshots = (
    await pool.query("SELECT * FROM snapshots ORDER BY t,symbol")
  ).rows;
  const path = process.argv[2] || "research/dataset.json";
  await writeFile(
    path,
    JSON.stringify({
      source: "prospective-market-observations",
      exportedAt: Date.now(),
      threshold: config.RETURN_THRESHOLD,
      featureVersion: FEATURE_VERSION,
      featureNames: FEATURE_NAMES,
      rows,
      snapshots,
    }),
  );
  console.log(JSON.stringify({ path, count: rows.length }));
} finally {
  await pool.end();
}
