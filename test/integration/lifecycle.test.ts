import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, postWebhook, drainWorker, type TestApp } from "../helpers/test-app.js";
import opened from "../fixtures/gitlab/mr_opened.json";
import draftOn from "../fixtures/gitlab/mr_draft_on.json";
import draftOff from "../fixtures/gitlab/mr_draft_off.json";
import approval from "../fixtures/gitlab/mr_approval.json";
import approvedQuorum from "../fixtures/gitlab/mr_approved_quorum.json";
import unapproval from "../fixtures/gitlab/mr_unapproval.json";
import unapproved from "../fixtures/gitlab/mr_unapproved.json";
import threadsResolved from "../fixtures/gitlab/mr_threads_resolved.json";
import merged from "../fixtures/gitlab/mr_merged.json";

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.cleanup();
});

describe("MR lifecycle", () => {
  it("walks open → draft → ready → approval → approved → merged and posts replies in-thread", async () => {
    const steps: Array<[string, object]> = [
      ["open", opened],
      ["drafton", draftOn],
      ["draftoff", draftOff],
      ["approval", approval],
      ["approved", approvedQuorum],
      ["merged", merged],
    ];
    for (const [tag, body] of steps) {
      await postWebhook(t.app, body, { webhookUuid: `wh-${tag}` });
    }
    await drainWorker(t.worker);

    // Exactly one top-level post
    expect(t.slack.filter("postParent")).toHaveLength(1);

    // Replies: draft-on, draft-off, approval, approved quorum, merged = 5
    const replies = t.slack.filter("postReply");
    expect(replies).toHaveLength(5);
    expect((replies[0] as { text: string }).text).toContain("Marked as draft");
    expect((replies[1] as { text: string }).text).toContain("Ready for review");
    expect((replies[2] as { text: string }).text).toContain("Approved by Example Reviewer");
    expect((replies[3] as { text: string }).text).toContain("All required approvals received");
    expect((replies[4] as { text: string }).text).toContain("Merged into `master`");

    // All replies target the same thread
    const threadTs = (replies[0] as { threadTs: string }).threadTs;
    for (const r of replies) {
      expect((r as { threadTs: string }).threadTs).toBe(threadTs);
    }

    // Parent status flipped to merged
    const row = await t.db.selectFrom("mr_threads").selectAll().executeTakeFirst();
    expect(row?.status).toBe("merged");

    // Parent was updated after every state-changing step (not after noops) —
    // we assert it was updated at least once and the latest update has Merged header
    const updates = t.slack.filter("updateParent");
    expect(updates.length).toBeGreaterThanOrEqual(1);
    const lastUpdate = updates[updates.length - 1] as { text: string };
    expect(lastUpdate.text).toContain("Merged");
  });

  it("unapproval drops approvals_count and reply reflects user", async () => {
    await postWebhook(t.app, opened, { webhookUuid: "wh-o" });
    await postWebhook(t.app, approval, { webhookUuid: "wh-a" });
    await postWebhook(t.app, unapproval, { webhookUuid: "wh-u" });
    await drainWorker(t.worker);

    const row = await t.db.selectFrom("mr_threads").selectAll().executeTakeFirst();
    expect(row?.approvals_count).toBe(0);

    const replies = t.slack.filter("postReply");
    expect(replies.map((r) => (r as { text: string }).text)).toEqual([
      "👍 Approved by Example Reviewer",
      "↩️ Approval revoked by Example Reviewer",
    ]);
  });

  it("all-threads-resolved posts a reply without touching the parent status", async () => {
    await postWebhook(t.app, opened, { webhookUuid: "wh-o" });
    await drainWorker(t.worker);
    const updatesBefore = t.slack.filter("updateParent").length;

    await postWebhook(t.app, threadsResolved, { webhookUuid: "wh-r" });
    await drainWorker(t.worker);

    const replies = t.slack.filter("postReply");
    expect(replies.map((r) => (r as { text: string }).text)).toEqual(["🧵 All threads resolved"]);

    // Status is unchanged, so the parent is left alone.
    expect(t.slack.filter("updateParent")).toHaveLength(updatesBefore);
    const row = await t.db.selectFrom("mr_threads").selectAll().executeTakeFirst();
    expect(row?.status).toBe("open");
  });

  it("unapproved flips the parent back to Open and warns in-thread", async () => {
    await postWebhook(t.app, opened, { webhookUuid: "wh-o" });
    await postWebhook(t.app, approvedQuorum, { webhookUuid: "wh-a" });
    await postWebhook(t.app, unapproved, { webhookUuid: "wh-u" });
    await drainWorker(t.worker);

    const row = await t.db.selectFrom("mr_threads").selectAll().executeTakeFirst();
    expect(row?.status).toBe("open");

    const replies = t.slack.filter("postReply");
    expect(replies.map((r) => (r as { text: string }).text)).toEqual([
      "✅ All required approvals received",
      "⚠️ Approval quorum lost — needs review again",
    ]);

    const updates = t.slack.filter("updateParent");
    const lastUpdate = updates[updates.length - 1] as { text: string };
    expect(lastUpdate).toBeDefined();
    expect(lastUpdate.text).toContain("Open");
  });
});
