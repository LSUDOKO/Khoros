#!/usr/bin/env node
/**
 * Migration runner.
 *
 * Applies every .sql file in migrations/ in filename order, once, inside a
 * transaction, recording what ran in a `migrations` table.
 *
 * Run: pnpm migrate
 */

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stdout.write(
      "DATABASE_URL is not set. Set it to a Postgres connection string and re-run.\n",
    );
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });

  await client.connect();

  await client.query(`
    create table if not exists migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const { rows } = await client.query("select name from migrations");
  const applied = new Set(rows.map((r) => r.name));

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let ran = 0;

  for (const file of files) {
    if (applied.has(file)) {
      process.stdout.write(`  skip   ${file} (already applied)\n`);
      continue;
    }

    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");

    // Each migration is atomic: a failure half way through leaves the schema
    // untouched rather than partially migrated.
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into migrations (name) values ($1)", [file]);
      await client.query("commit");
      process.stdout.write(`  applied ${file}\n`);
      ran += 1;
    } catch (error) {
      await client.query("rollback");
      process.stdout.write(`\n  FAILED  ${file}\n  ${error?.message ?? error}\n`);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  process.stdout.write(
    ran === 0 ? "\nSchema already up to date.\n" : `\n${ran} migration(s) applied.\n`,
  );
}

main().catch((error) => {
  process.stdout.write(`\nMigration failed: ${error?.stack ?? error}\n`);
  process.exit(1);
});
