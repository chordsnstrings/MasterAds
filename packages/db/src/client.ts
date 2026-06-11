import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema> & { $pool: pg.Pool };

export function connectionString(): string {
  return process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/adengine";
}

/**
 * TLS settings for managed Postgres (DigitalOcean injects sslmode=require).
 * With DATABASE_CA_CERT set the server certificate is verified against it;
 * without it TLS is still used, but managed providers sign with a private CA
 * node cannot verify, so peer verification is disabled (encrypted transport,
 * unauthenticated peer). Local URLs without sslmode stay plaintext.
 */
export function sslConfig(
  url: string = connectionString(),
): { ca: string } | { rejectUnauthorized: false } | undefined {
  const mode = /[?&]sslmode=([^&\s]+)/.exec(url)?.[1] ?? process.env.PGSSLMODE;
  if (!mode || mode === "disable") return undefined;
  const ca = process.env.DATABASE_CA_CERT;
  return ca ? { ca } : { rejectUnauthorized: false };
}

/** Strip sslmode from the URL so pg doesn't override the explicit ssl config. */
function withoutSslmode(url: string): string {
  return url.replace(/([?&])sslmode=[^&\s]+&?/, "$1").replace(/[?&]$/, "");
}

/**
 * Connection options for pg/pg-boss. node-postgres parses the connection
 * string LAST, so an in-URL sslmode would override the explicit ssl option —
 * the sslmode is therefore stripped and ssl passed explicitly. Every
 * connection in the system (pool, migrations, queues) must come through here.
 */
export function connectionOptions(url: string = connectionString()): {
  connectionString: string;
  ssl: ReturnType<typeof sslConfig>;
} {
  return { connectionString: withoutSslmode(url), ssl: sslConfig(url) };
}

export function createDb(url: string = connectionString()): Db {
  const pool = new pg.Pool({ ...connectionOptions(url), max: 10 });
  const db = drizzle(pool, { schema }) as unknown as Db;
  db.$pool = pool;
  return db;
}

export async function closeDb(db: Db): Promise<void> {
  await db.$pool.end();
}
