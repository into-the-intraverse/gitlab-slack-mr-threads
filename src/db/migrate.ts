import { Migrator, type MigrationProvider, type Migration } from "kysely";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../config.js";
import { makeLogger } from "../logger.js";
import { openDb, type KyselyDb } from "./index.js";

/**
 * A migration provider that works on Windows by converting the absolute path
 * to a file:// URL before passing it to dynamic import(). Node.js ESM on
 * Windows rejects bare drive-letter paths like D:\... from import().
 */
class WindowsSafeFileMigrationProvider implements MigrationProvider {
  constructor(private readonly migrationsFolder: string) {}

  async getMigrations(): Promise<Record<string, Migration>> {
    const migrations: Record<string, Migration> = {};
    const files = await fs.readdir(this.migrationsFolder);
    for (const fileName of files) {
      if (
        (fileName.endsWith(".js") ||
          (fileName.endsWith(".ts") && !fileName.endsWith(".d.ts")) ||
          fileName.endsWith(".mjs") ||
          (fileName.endsWith(".mts") && !fileName.endsWith(".d.mts"))) === false
      ) {
        continue;
      }
      const fullPath = path.join(this.migrationsFolder, fileName);
      const fileUrl = pathToFileURL(fullPath).href;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const mod = await import(fileUrl);
      const migrationKey = fileName.substring(0, fileName.lastIndexOf("."));
      // Handle esModuleInterop default export
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const resolved = mod?.default ?? mod;
      if (isMigration(resolved)) {
        migrations[migrationKey] = resolved;
      }
    }
    return migrations;
  }
}

function isMigration(obj: unknown): obj is Migration {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "up" in obj &&
    typeof (obj as Record<string, unknown>)["up"] === "function"
  );
}

export async function migrateToLatest(db: KyselyDb, migrationsFolder: string): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: new WindowsSafeFileMigrationProvider(migrationsFolder),
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
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const cfg = loadConfig(process.env);
  const log = makeLogger(cfg);
  const { db } = openDb(cfg.databaseUrl);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const folder = path.resolve(here, "../../migrations");
  migrateToLatest(db, folder)
    .then(() => {
      log.info({ folder }, "migrations applied");
      return db.destroy();
    })
    .catch((e) => {
      log.error({ err: e }, "migration failed");
      process.exit(1);
    });
}
