import { describe, expect, it } from "vitest";
import { countPending } from "../../src/persistence/inbox.js";
import { listProjects } from "../../src/settings/projects.js";
import opened from "../fixtures/gitlab/mr_opened.json" with { type: "json" };
import { createTestApp, drainWorker, postWebhook } from "../helpers/test-app.js";

describe("an instance with no default channel", () => {
  it("holds events in the inbox instead of failing them", async () => {
    const t = await createTestApp({ defaultChannel: null });
    try {
      await postWebhook(t.app, opened, { webhookUuid: "wh-hold-1" });
      await drainWorker(t.worker);

      expect(t.slack.calls).toHaveLength(0);
      expect(await countPending(t.db)).toBe(1);
    } finally {
      await t.cleanup();
    }
  });

  it("delivers what it held once a channel is set", async () => {
    const t = await createTestApp({ defaultChannel: null });
    try {
      await postWebhook(t.app, opened, { webhookUuid: "wh-hold-2" });
      await drainWorker(t.worker);
      expect(t.slack.calls).toHaveLength(0);

      await t.settings.write({ default_channel_id: "C-LATE" }, { userId: "U1", name: "Alex" });
      await drainWorker(t.worker);

      expect(t.slack.filter("postParent")).toHaveLength(1);
      expect(t.slack.calls[0]).toMatchObject({ channel: "C-LATE" });
      expect(await countPending(t.db)).toBe(0);
    } finally {
      await t.cleanup();
    }
  });

  it("records the project the first time it sends an event", async () => {
    const t = await createTestApp();
    try {
      await postWebhook(t.app, opened, { webhookUuid: "wh-discover" });
      await drainWorker(t.worker);

      const projects = await listProjects(t.db);
      expect(projects).toHaveLength(1);
      expect(projects[0]).toMatchObject({ project_id: 12345, enabled: true, channel_id: null });
    } finally {
      await t.cleanup();
    }
  });

  it("drops events from a project that was switched off", async () => {
    const t = await createTestApp();
    try {
      await postWebhook(t.app, opened, { webhookUuid: "wh-off-1" });
      await drainWorker(t.worker);
      t.slack.calls.length = 0;

      await t.setProjectOff(12345);

      await postWebhook(t.app, opened, { webhookUuid: "wh-off-2" });
      await drainWorker(t.worker);

      expect(t.slack.calls).toHaveLength(0);
      // Dropped, not held: "off" is a decision, "unconfigured" is temporary.
      expect(await countPending(t.db)).toBe(0);
    } finally {
      await t.cleanup();
    }
  });
});
