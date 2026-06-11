// Forward-only migration runner. Applies packages/db/migrations/*.sql in
// filename order inside transactions; applied files are never edited.
// Wired as the PRE_DEPLOY job in .do/app.yaml so schema and code ship together.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { sslConfig } from "./client.js";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function runMigrations(databaseUrl: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl, ssl: sslConfig(databaseUrl) });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const { rows } = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [
        file,
      ]);
      if (rows.length > 0) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  const url = process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/adengine";
  runMigrations(url)
    .then((applied) => {
      console.log(JSON.stringify({ msg: "migrations complete", applied }));
      process.exit(0);
    })
    .catch((err) => {
      console.error(JSON.stringify({ msg: "migration failed", error: String(err) }));
      process.exit(1);
    });
}
