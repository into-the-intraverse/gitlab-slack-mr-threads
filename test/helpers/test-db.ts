import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type KyselyDb } from "../../src/db/index.js";
import { migrateToLatest } from "../../src/db/migrate.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export type TestDb = {
  db: KyselyDb;
  cleanup: () => Promise<void>;
};

export async function createTestDb(): Promise<TestDb> {
  const dir = mkdtempSync(join(tmpdir(), "glsp-"));
  const dbPath = join(dir, "test.db");
  const { db } = openDb(`file:${dbPath}`);

  const here = dirname(fileURLToPath(import.meta.url));
  const folder = resolve(here, "../../migrations");
  await migrateToLatest(db, folder);

  return {
    db,
    cleanup: async () => {
      await db.destroy();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
