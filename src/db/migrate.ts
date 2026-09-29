import { fileURLToPath } from "node:url";
import { type Migration, Migrator } from "kysely";
import { loadConfig } from "../config.js";
import { makeLogger } from "../logger.js";
import { type KyselyDb, openDb } from "./index.js";
import { MIGRATIONS } from "./migrations/index.js";

/**
 * Applies every pending migration.
 *
 * `migrations` is injectable for tests; production always uses the static list,
 * so there is no filesystem, no dynamic import and no path to resolve — the
 * compiled build and `bun run dev` run exactly the same code.
 */
export async function migrateToLatest(
  db: KyselyDb,
  migrations: Record<string, Migration> = MIGRATIONS,
): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: { getMigrations: async () => migrations },
  });

  const { error, results } = await migrator.migrateToLatest();
  if (error) {
    throw new Error(`Migration failed: ${String(error)}`);
  }
  for (const r of results ?? []) {
    if (r.status === "Error") {
      throw new Error(`Migration ${r.migrationName} failed`);
    }
  }
}

// CLI entry: `bun run migrate`
// Use fileURLToPath for cross-platform comparison (Windows uses backslashes in process.argv[1])
// Never true under vitest, so it is left out of coverage and out of mutation
// testing rather than faked.
/* v8 ignore start */
// Stryker disable all
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const cfg = loadConfig(process.env);
  const log = makeLogger(cfg);
  const { db } = openDb(cfg.databaseUrl);
  migrateToLatest(db)
    .then(() => {
      log.info({ count: Object.keys(MIGRATIONS).length }, "migrations applied");
      return db.destroy();
    })
    .catch((e) => {
      log.error({ err: e }, "migration failed");
      process.exit(1);
    });
}
// Stryker restore all
