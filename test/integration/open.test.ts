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

describe("open MR", () => {
  it("creates exactly one parent message and one mr_threads row", async () => {
    const res = await postWebhook(t.app, opened, { webhookUuid: "wh-open-1" });
    expect(res.statusCode).toBe(200);

    await drainWorker(t.worker);

    const postParents = t.slack.filter("postParent");
    expect(postParents).toHaveLength(1);
    expect(t.slack.filter("updateParent")).toHaveLength(0);
    expect(t.slack.filter("postReply")).toHaveLength(0);

    const row = await t.db
      .selectFrom("mr_threads")
      .selectAll()
      .executeTakeFirst();
    expect(row?.project_id).toBe(12345);
    expect(row?.mr_iid).toBe(551);
    expect(row?.jira_key).toBe("SD-36717");
    expect(row?.status).toBe("open");
    expect(row?.slack_thread_ts).toBeTruthy();
  });

  it("parent message text contains Jira key and status", async () => {
    await postWebhook(t.app, opened, { webhookUuid: "wh-open-2" });
    await drainWorker(t.worker);
    const parent = t.slack.filter("postParent")[0];
    expect(parent?.text).toContain("[SD-36717]");
    expect(parent?.text).toContain("Open");
  });
});
