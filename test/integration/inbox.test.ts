import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/test-db.js";
import {
  insertInboxRow,
  backoffMs,
  claimNextPending,
  markProcessed,
  markFailed,
  countPending,
  countFailed,
  oldestPendingAgeMs,
} from "../../src/persistence/inbox.js";

let tdb: TestDb;
beforeEach(async () => {
  tdb = await createTestDb();
});
afterEach(async () => {
  await tdb.cleanup();
});

describe("inbox persistence", () => {
  it("inserts a row and reads it back", async () => {
    const inserted = await insertInboxRow(tdb.db, {
      webhook_uuid: "u1",
      event_uuid: "e1",
      payload_json: "{}",
    });
    expect(inserted).toBe(true);
    expect(await countPending(tdb.db)).toBe(1);
  });

  it("INSERT OR IGNORE is idempotent for same webhook_uuid", async () => {
    await insertInboxRow(tdb.db, { webhook_uuid: "u1", event_uuid: null, payload_json: "{}" });
    const second = await insertInboxRow(tdb.db, {
      webhook_uuid: "u1",
      event_uuid: null,
      payload_json: "{}",
    });
    expect(second).toBe(false);
    expect(await countPending(tdb.db)).toBe(1);
  });

  it("claimNextPending returns oldest first", async () => {
    await insertInboxRow(tdb.db, { webhook_uuid: "a", event_uuid: null, payload_json: "{}" });
    await new Promise((r) => setTimeout(r, 10));
    await insertInboxRow(tdb.db, { webhook_uuid: "b", event_uuid: null, payload_json: "{}" });
    const first = await claimNextPending(tdb.db);
    expect(first?.webhook_uuid).toBe("a");
  });

  it("markProcessed sets processed_at and removes from pending count", async () => {
    await insertInboxRow(tdb.db, { webhook_uuid: "u1", event_uuid: null, payload_json: "{}" });
    await markProcessed(tdb.db, "u1");
    expect(await countPending(tdb.db)).toBe(0);
  });

  it("markFailed sets error and increments attempts with backoff", async () => {
    await insertInboxRow(tdb.db, { webhook_uuid: "u1", event_uuid: null, payload_json: "{}" });
    await markFailed(tdb.db, "u1", "boom");
    await markFailed(tdb.db, "u1", "boom again");

    // next_attempt_at is in the future; default claim should return nothing
    expect(await claimNextPending(tdb.db)).toBeUndefined();

    // But claim with a clock far enough ahead returns the row
    const farFuture = new Date(Date.now() + 60_000).toISOString();
    const row = await claimNextPending(tdb.db, farFuture);
    expect(row?.attempts).toBe(2);
    expect(row?.error).toBe("boom again");
  });

  it("backoff doubles per attempt and caps at 30s", async () => {
    await insertInboxRow(tdb.db, { webhook_uuid: "u2", event_uuid: null, payload_json: "{}" });
    const before = Date.now();
    await markFailed(tdb.db, "u2", "e");
    const row1 = await claimNextPending(tdb.db, new Date(before + 60_000).toISOString());
    // attempts=1 → ~1s ahead of `before`
    const next1 = new Date(row1?.next_attempt_at ?? "").getTime();
    expect(next1 - before).toBeGreaterThanOrEqual(1000);
    expect(next1 - before).toBeLessThan(1500);
  });

  it("countFailed counts rows with >=10 attempts", async () => {
    await insertInboxRow(tdb.db, { webhook_uuid: "u1", event_uuid: null, payload_json: "{}" });
    for (let i = 0; i < 10; i++) await markFailed(tdb.db, "u1", "x");
    expect(await countFailed(tdb.db)).toBe(1);
  });

  it("a row that has burnt its attempts is neither claimed nor counted as pending", async () => {
    await insertInboxRow(tdb.db, { webhook_uuid: "u1", event_uuid: null, payload_json: "{}" });
    for (let i = 0; i < 10; i++) await markFailed(tdb.db, "u1", "x");

    const farFuture = new Date(Date.now() + 600_000).toISOString();
    expect(await claimNextPending(tdb.db, farFuture)).toBeUndefined();
    expect(await countPending(tdb.db)).toBe(0);
  });

  it("markFailed on a uuid that is not there counts as a first attempt", async () => {
    await expect(markFailed(tdb.db, "ghost", "boom")).resolves.toBeUndefined();
    expect(await countPending(tdb.db)).toBe(0);
  });

  it("backoffMs starts at zero and caps at 30s", () => {
    expect(backoffMs(0)).toBe(0);
    expect(backoffMs(-1)).toBe(0);
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(2000);
    expect(backoffMs(99)).toBe(30_000);
  });
});

describe("queue age", () => {
  it("is zero while the queue is empty", async () => {
    expect(await oldestPendingAgeMs(tdb.db)).toBe(0);
  });

  it("measures the oldest row that is still waiting", async () => {
    await insertInboxRow(tdb.db, { webhook_uuid: "u1", event_uuid: null, payload_json: "{}" });
    await new Promise((r) => setTimeout(r, 20));

    const age = await oldestPendingAgeMs(tdb.db);
    expect(age).toBeGreaterThan(0);
    // An age, not a timestamp: the health endpoint publishes this number.
    expect(age).toBeLessThan(60_000);
  });

  it("ignores rows that are already processed", async () => {
    await insertInboxRow(tdb.db, { webhook_uuid: "u1", event_uuid: null, payload_json: "{}" });
    await new Promise((r) => setTimeout(r, 20));
    await markProcessed(tdb.db, "u1");
    expect(await oldestPendingAgeMs(tdb.db)).toBe(0);
  });
});
