import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, postWebhook, drainWorker, type TestApp } from "../helpers/test-app.js";
import opened from "../fixtures/gitlab/mr_opened.json";

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.cleanup();
});

describe("two MRs with same Jira key", () => {
  it("creates two independent parent messages", async () => {
    // First MR — as-is
    await postWebhook(t.app, opened, { webhookUuid: "wh-a" });
    // Second MR — same Jira key, different iid
    const other = {
      ...opened,
      object_attributes: { ...opened.object_attributes, iid: 552 },
    };
    await postWebhook(t.app, other, { webhookUuid: "wh-b" });

    await drainWorker(t.worker);

    expect(t.slack.filter("postParent")).toHaveLength(2);

    const rows = await t.db
      .selectFrom("mr_threads")
      .selectAll()
      .orderBy("mr_iid", "asc")
      .execute();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.jira_key).toBe("SD-36717");
    expect(rows[1]?.jira_key).toBe("SD-36717");
    expect(rows[0]?.slack_thread_ts).not.toBe(rows[1]?.slack_thread_ts);
  });
});
