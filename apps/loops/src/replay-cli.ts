// Replay/backfill command (GOALS G3):
//   pnpm --filter @engine/loops run replay -- --from 2026-06-01 --to 2026-06-10 [--platform meta]
import PgBoss from "pg-boss";
import { connectionString, createDb, closeDb, createRepos, sslConfig } from "@engine/db";
import { replayWindow } from "./relay-worker.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const from = arg("from");
const to = arg("to");
const platform = arg("platform") as
  | "meta"
  | "google"
  | "tiktok"
  | "snapchat"
  | "pinterest"
  | undefined;
if (!from || !to) {
  console.error("usage: replay --from <ISO date> --to <ISO date> [--platform meta|google|tiktok|snapchat|pinterest]");
  process.exit(1);
}

const db = createDb();
const boss = new PgBoss({ connectionString: connectionString(), ssl: sslConfig() });
await boss.start();
try {
  const n = await replayWindow(boss, createRepos(db), {
    from: new Date(from),
    to: new Date(to),
    platform,
  });
  console.log(`replay: ${n} relay jobs enqueued`);
} finally {
  await boss.stop();
  await closeDb(db);
}
