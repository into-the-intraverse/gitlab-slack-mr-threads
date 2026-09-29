import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../../src/db/index.js";

describe("openDb", () => {
  it("rejects anything that is not a file: URL", () => {
    expect(() => openDb("postgres://localhost/app")).toThrow(/Only file: URLs/);
  });

  it("creates the parent directory for the database file", async () => {
    // As in test-app.ts, the tmpdir is left for the OS to reap: Windows holds the
    // sqlite file handle past close() and rmSync then fails with EPERM.
    const file = join(mkdtempSync(join(tmpdir(), "glsp-open-")), "nested", "app.db");

    const { db, raw } = openDb(`file:${file}`);

    expect(existsSync(file)).toBe(true);
    expect(raw.pragma("journal_mode", { simple: true })).toBe("wal");
    await db.destroy();
  });
});
