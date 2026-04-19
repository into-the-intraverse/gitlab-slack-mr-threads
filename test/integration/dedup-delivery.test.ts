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

describe("duplicate delivery dedup", () => {
  it("same X-Gitlab-Webhook-UUID delivered 3x → Slack called exactly once", async () => {
    const first = await postWebhook(t.app, opened, { webhookUuid: "same-uuid" });
    const second = await postWebhook(t.app, opened, { webhookUuid: "same-uuid" });
    const third = await postWebhook(t.app, opened, { webhookUuid: "same-uuid" });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(200);
    expect(JSON.parse(first.body).duplicate).toBe(false);
    expect(JSON.parse(second.body).duplicate).toBe(true);
    expect(JSON.parse(third.body).duplicate).toBe(true);

    await drainWorker(t.worker);

    expect(t.slack.filter("postParent")).toHaveLength(1);

    const inbox = await t.db.selectFrom("inbox").selectAll().execute();
    expect(inbox).toHaveLength(1);
  });
});
