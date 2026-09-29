import { type Migration, Migrator, NO_MIGRATIONS } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Kysely reports a failure twice: once as `error`, once as a result with status
// "Error". Only the first can be produced by a real migration, so the second
// check is answered for.
const h = vi.hoisted(() => ({
  stubResult: null as {
    error?: unknown;
    results?: Array<{ status: string; migrationName?: string }>;
  } | null,
}));

vi.mock("kysely", async (importOriginal) => {
  const actual = await importOriginal<typeof import("kysely")>();
  class TestMigrator extends actual.Migrator {
    override async migrateToLatest() {
      if (h.stubResult) return h.stubResult as never;
      return await super.migrateToLatest();
    }
  }
  return { ...actual, Migrator: TestMigrator };
});

const { openDb } = await import("../../src/db/index.js");
const { migrateToLatest } = await import("../../src/db/migrate.js");
const { MIGRATIONS } = await import("../../src/db/migrations/index.js");

let db: Awaited<ReturnType<typeof openDb>>["db"];
let raw: Awaited<ReturnType<typeof openDb>>["raw"];

const tableNames = () =>
  (raw.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[])
    .map((r) => r.name)
    .sort();

const applied = () =>
  (raw.prepare("select name from kysely_migration order by name").all() as { name: string }[]).map(
    (r) => r.name,
  );

const table = (name: string): Migration => ({
  up: async (d) =>
    void (await d.schema
      .createTable(name)
      .addColumn("id", "integer", (c) => c.primaryKey())
      .execute()),
  down: async (d) => void (await d.schema.dropTable(name).execute()),
});

beforeEach(() => {
  ({ db, raw } = openDb("file::memory:"));
});

afterEach(async () => {
  h.stubResult = null;
  await db.destroy();
});

describe("migrateToLatest", () => {
  it("applies the real migrations in numeric order", async () => {
    await migrateToLatest(db);

    expect(applied()).toEqual(Object.keys(MIGRATIONS).sort());
    expect(tableNames()).toEqual(
      expect.arrayContaining([
        "audit_log",
        "inbox",
        "mr_threads",
        "project_settings",
        "settings",
        "settings_audit",
      ]),
    );
  });

  it("is idempotent — a second run applies nothing", async () => {
    await migrateToLatest(db);
    await migrateToLatest(db);

    expect(applied()).toHaveLength(Object.keys(MIGRATIONS).length);
  });

  it("runs an injected set in key order, not in the order they were written", async () => {
    await migrateToLatest(db, { "002_second": table("second"), "001_first": table("first") });

    expect(applied()).toEqual(["001_first", "002_second"]);
  });

  it("throws when a migration blows up", async () => {
    const boom: Migration = {
      up: async () => {
        throw new Error("boom");
      },
    };

    await expect(migrateToLatest(db, { "001_boom": boom })).rejects.toThrow(/Migration failed/);
  });

  it("throws when a later migration fails, and keeps the earlier one", async () => {
    const boom: Migration = {
      up: async () => {
        throw new Error("boom");
      },
    };

    await expect(migrateToLatest(db, { "001_ok": table("ok"), "002_boom": boom })).rejects.toThrow(
      /Migration failed/,
    );
    expect(applied()).toEqual(["001_ok"]);
  });

  it("accepts an empty set", async () => {
    await expect(migrateToLatest(db, {})).resolves.toBeUndefined();
  });

  // Nothing in the bot ever migrates down, which is exactly why the rollbacks
  // are worth running once: a `down` nobody has executed is a landmine for the
  // person who needs it at the worst possible moment.
  it("can roll every migration back", async () => {
    await migrateToLatest(db);
    // `kysely_*` is the migrator's own bookkeeping and `sqlite_sequence` is
    // sqlite's, left behind by the AUTOINCREMENT columns.
    const userTables = () =>
      tableNames().filter((n) => !n.startsWith("kysely_") && !n.startsWith("sqlite_"));
    expect(userTables().length).toBeGreaterThan(0);

    const migrator = new Migrator({ db, provider: { getMigrations: async () => MIGRATIONS } });
    const { error } = await migrator.migrateTo(NO_MIGRATIONS);

    expect(error).toBeUndefined();
    expect(userTables()).toEqual([]);
  });

  it("throws when a result reports Error even though the migrator did not", async () => {
    h.stubResult = {
      results: [
        { status: "Success", migrationName: "001_ok" },
        { status: "Error", migrationName: "002_bad" },
      ],
    };

    await expect(migrateToLatest(db)).rejects.toThrow(/Migration 002_bad failed/);
  });

  it("accepts a run that reports no results at all", async () => {
    h.stubResult = {};

    await expect(migrateToLatest(db)).resolves.toBeUndefined();
  });
});
