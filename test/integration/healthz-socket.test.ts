import { describe, expect, it } from "vitest";
import opened from "../fixtures/gitlab/mr_opened.json";
import { createTestApp, postWebhook } from "../helpers/test-app.js";

describe("GET /healthz", () => {
  it("reports the socket as connected without gating readiness on it", async () => {
    const t = await createTestApp({ socketConnected: () => false });
    try {
      const res = await t.app.inject({ method: "GET", url: "/healthz" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // A Slack-side outage must not take the container out of rotation: the
      // webhook intake is what keeps events from being lost.
      expect(body.ok).toBe(true);
      expect(body.slack_socket_connected).toBe(false);
    } finally {
      await t.cleanup();
    }
  });

  it("says nothing about a socket when there is none", async () => {
    const t = await createTestApp();
    try {
      const body = (await t.app.inject({ method: "GET", url: "/healthz" })).json();
      expect(body.slack_socket_connected).toBeNull();
    } finally {
      await t.cleanup();
    }
  });

  it("reports the depth and the age of the queue", async () => {
    const t = await createTestApp();
    try {
      const empty = (await t.app.inject({ method: "GET", url: "/healthz" })).json();
      expect(empty).toMatchObject({
        inbox_pending: 0,
        inbox_failed: 0,
        oldest_pending_age_ms: 0,
      });

      await postWebhook(t.app, opened, { webhookUuid: "wh-1" });
      await new Promise((r) => setTimeout(r, 5));

      const queued = (await t.app.inject({ method: "GET", url: "/healthz" })).json();
      expect(queued.inbox_pending).toBe(1);
      expect(queued.oldest_pending_age_ms).toBeGreaterThan(0);
    } finally {
      await t.cleanup();
    }
  });
});
