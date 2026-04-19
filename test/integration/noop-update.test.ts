import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, postWebhook, drainWorker, type TestApp } from "../helpers/test-app.js";
import opened from "../fixtures/gitlab/mr_opened.json";
import noop from "../fixtures/gitlab/mr_update_noop.json";

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.cleanup();
});

describe("noop update", () => {
  it("label-only update emits no Slack call and leaves an audit skip row", async () => {
    await postWebhook(t.app, opened, { webhookUuid: "wh-o" });
    await postWebhook(t.app, noop, { webhookUuid: "wh-noop" });
    await drainWorker(t.worker);

    expect(t.slack.filter("postParent")).toHaveLength(1);
    expect(t.slack.filter("postReply")).toHaveLength(0);
    expect(t.slack.filter("updateParent")).toHaveLength(0);

    const skips = await t.db
      .selectFrom("audit_log")
      .selectAll()
      .where("slack_action", "=", "skip")
      .execute();
    expect(skips.length).toBeGreaterThanOrEqual(1);
  });
});
