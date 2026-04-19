import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/test-db.js";
import {
  getMrThread,
  insertMrThread,
  updateMrThread,
} from "../../src/persistence/mr-threads.js";

let tdb: TestDb;
beforeEach(async () => {
  tdb = await createTestDb();
});
afterEach(async () => {
  await tdb.cleanup();
});

const sample = {
  project_id: 1,
  mr_iid: 551,
  slack_channel_id: "C1",
  slack_thread_ts: "1700000000.000100",
  jira_key: "SD-36717",
  title: "t",
  author_name: "Alex",
  source_branch: "f/x",
  target_branch: "master",
  web_url: "https://example/mr/551",
  status: "open" as const,
  last_parent_hash: "h0",
};

describe("mr_threads persistence", () => {
  it("inserts and fetches by identity", async () => {
    await insertMrThread(tdb.db, sample);
    const row = await getMrThread(tdb.db, 1, 551);
    expect(row?.slack_thread_ts).toBe("1700000000.000100");
    expect(row?.status).toBe("open");
  });

  it("UNIQUE(project_id, mr_iid) prevents duplicate parents", async () => {
    await insertMrThread(tdb.db, sample);
    await expect(insertMrThread(tdb.db, sample)).rejects.toThrow();
  });

  it("allows same jira_key across different MRs", async () => {
    await insertMrThread(tdb.db, sample);
    await insertMrThread(tdb.db, { ...sample, mr_iid: 552 });
    const a = await getMrThread(tdb.db, 1, 551);
    const b = await getMrThread(tdb.db, 1, 552);
    expect(a?.slack_thread_ts).toBe("1700000000.000100");
    expect(b?.slack_thread_ts).toBe("1700000000.000100");
    expect(a?.id).not.toBe(b?.id);
  });

  it("updateMrThread applies partial changes", async () => {
    await insertMrThread(tdb.db, sample);
    await updateMrThread(tdb.db, 1, 551, {
      status: "merged",
      last_parent_hash: "h1",
      approvals_count: 2,
    });
    const row = await getMrThread(tdb.db, 1, 551);
    expect(row?.status).toBe("merged");
    expect(row?.approvals_count).toBe(2);
    expect(row?.last_parent_hash).toBe("h1");
  });

  it("getMrThread returns undefined for missing row", async () => {
    expect(await getMrThread(tdb.db, 9, 9)).toBeUndefined();
  });
});
