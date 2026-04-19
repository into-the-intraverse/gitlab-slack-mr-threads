import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, postWebhook, type TestApp } from "../helpers/test-app.js";
import opened from "../fixtures/gitlab/mr_opened.json";

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.cleanup();
});

describe("webhook auth", () => {
  it("rejects requests with wrong X-Gitlab-Token and does not persist inbox row", async () => {
    const res = await postWebhook(t.app, opened, {
      webhookUuid: "wh-bad",
      token: "wrong",
    });
    expect(res.statusCode).toBe(401);

    const rows = await t.db.selectFrom("inbox").selectAll().execute();
    expect(rows).toHaveLength(0);
  });
});
