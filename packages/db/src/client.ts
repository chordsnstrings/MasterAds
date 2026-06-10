import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema> & { $pool: pg.Pool };

export function connectionString(): string {
  return process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/adengine";
}

export function createDb(url: string = connectionString()): Db {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema }) as unknown as Db;
  db.$pool = pool;
  return db;
}

export async function closeDb(db: Db): Promise<void> {
  await db.$pool.end();
}
