import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type KyselyDb, openDb } from "../../src/db/index.js";
import { migrateToLatest } from "../../src/db/migrate.js";

export type TestDb = {
  db: KyselyDb;
  cleanup: () => Promise<void>;
};

export async function createTestDb(): Promise<TestDb> {
  const dir = mkdtempSync(join(tmpdir(), "glsp-"));
  const dbPath = join(dir, "test.db");
  const { db } = openDb(`file:${dbPath}`);
  await migrateToLatest(db);

  return {
    db,
    cleanup: async () => {
      await db.destroy();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
