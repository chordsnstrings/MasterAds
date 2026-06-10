// Test helpers: a fresh database (schema dropped and re-migrated from zero).
import pg from "pg";
import { createDb, type Db } from "./client.js";
import { runMigrations } from "./migrate.js";

export function testDatabaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@127.0.0.1:5432/adengine_test"
  );
}

/** Drops everything and re-applies all migrations from zero. */
export async function resetTestDb(): Promise<Db> {
  const url = testDatabaseUrl();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await client.query("DROP SCHEMA IF EXISTS pgboss CASCADE;");
  await client.end();
  await runMigrations(url);
  return createDb(url);
}
