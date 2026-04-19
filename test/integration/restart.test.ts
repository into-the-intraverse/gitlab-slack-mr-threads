import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, postWebhook, drainWorker, type TestApp } from "../helpers/test-app.js";
import opened from "../fixtures/gitlab/mr_opened.json";

let first: TestApp;
let second: TestApp | null = null;
beforeEach(async () => {
  first = await createTestApp();
});
afterEach(async () => {
  if (second) {
    await second.cleanup();
    second = null;
  } else {
    await first.cleanup();
  }
});

describe("restart recovery", () => {
  it("pending inbox rows are processed by a new worker after restart", async () => {
    await postWebhook(first.app, opened, { webhookUuid: "wh-restart" });

    // Shut down without draining the worker — simulates crash
    const dbPath = first.dbPath;
    await first.cleanup();

    second = await createTestApp({ dbPath });
    await drainWorker(second.worker);

    expect(second.slack.filter("postParent")).toHaveLength(1);
    const rows = await second.db.selectFrom("mr_threads").selectAll().execute();
    expect(rows).toHaveLength(1);
  });
});
