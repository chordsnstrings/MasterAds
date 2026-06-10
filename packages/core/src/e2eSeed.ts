// E2E seed: reset the target database from zero, migrate, seed demo data and
// playbooks. Used by Playwright globalSetup and pnpm e2e:full.
import pg from "pg";
import { closeDb, createDb, createRepos, runMigrations, seed } from "@engine/db";
import { seedPlaybooks } from "./playbooks/index.js";

export async function resetAndSeed(databaseUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await client.query("DROP SCHEMA IF EXISTS pgboss CASCADE;");
  await client.end();
  await runMigrations(databaseUrl);
  const db = createDb(databaseUrl);
  try {
    await seed(db);
    await seedPlaybooks(createRepos(db));
  } finally {
    await closeDb(db);
  }
}

if (process.argv[1] && process.argv[1].endsWith("e2eSeed.ts")) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL required");
    process.exit(1);
  }
  resetAndSeed(url)
    .then(() => {
      console.log(JSON.stringify({ msg: "e2e seed complete", url: url.split("@").pop() }));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
