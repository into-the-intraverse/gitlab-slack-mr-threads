import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countPending, insertInboxRow } from "../../src/persistence/inbox.js";
import { listProjects } from "../../src/settings/projects.js";
import approval from "../fixtures/gitlab/mr_approval.json";
import draftOff from "../fixtures/gitlab/mr_draft_off.json";
import opened from "../fixtures/gitlab/mr_opened.json";
import openedReviewers from "../fixtures/gitlab/mr_opened_reviewers.json";
import noopUpdate from "../fixtures/gitlab/mr_update_noop.json";
import { type TestApp, createTestApp, drainWorker, postWebhook } from "../helpers/test-app.js";

const SEEDER = { userId: "U-TEST", name: "Test Setup" };

const auditRows = (t: TestApp) => t.db.selectFrom("audit_log").selectAll().execute();
const threadRow = (t: TestApp) =>
  t.db.selectFrom("mr_threads").selectAll().executeTakeFirstOrThrow();

let t: TestApp;
afterEach(async () => {
  await t.cleanup();
});

describe("a payload the worker cannot read", () => {
  beforeEach(async () => {
    t = await createTestApp();
  });

  // Both shapes reach the worker only if something wrote them by hand or GitLab
  // changed the contract; either way the row must not block the queue forever.
  it("skips a row whose payload is not JSON at all", async () => {
    await insertInboxRow(t.db, {
      webhook_uuid: "wh-garbage",
      event_uuid: null,
      payload_json: "not json",
    });

    // `true` is the contract that keeps the drain loop going: the pass did work,
    // even though the work was "throw this row away".
    await expect(t.worker.processOnce()).resolves.toBe(true);
    await expect(t.worker.processOnce()).resolves.toBe(false);

    expect(t.slack.calls).toHaveLength(0);
    expect(await countPending(t.db)).toBe(0);
    expect(await auditRows(t)).toMatchObject([{ slack_action: "skip", action: "unknown" }]);
  });

  it("skips a row that is JSON but not a merge request event", async () => {
    await insertInboxRow(t.db, {
      webhook_uuid: "wh-push",
      event_uuid: null,
      payload_json: JSON.stringify({ object_kind: "push", commits: [] }),
    });

    await drainWorker(t.worker);

    expect(await countPending(t.db)).toBe(0);
    expect(await auditRows(t)).toMatchObject([{ slack_action: "skip" }]);
  });
});

describe("Slack being down", () => {
  beforeEach(async () => {
    t = await createTestApp();
  });

  it("keeps the event for a retry instead of dropping it", async () => {
    t.slack.postError = new Error("slack_unavailable");

    await postWebhook(t.app, opened, { webhookUuid: "wh-1" });
    await expect(t.worker.processOnce()).resolves.toBe(true);

    const [row] = await t.db.selectFrom("inbox").selectAll().execute();
    expect(row?.attempts).toBe(1);
    expect(row?.error).toMatch(/slack_unavailable/);
    expect(row?.processed_at).toBeNull();
    expect(await auditRows(t)).toMatchObject([{ slack_action: "error", project_id: 12345 }]);
  });

  it("records a rejection that is not an Error at all", async () => {
    // A rejected promise can carry anything; the inbox still needs a message.
    t.slack.postError = "rate limited" as unknown as Error;

    await postWebhook(t.app, opened, { webhookUuid: "wh-1" });
    await drainWorker(t.worker);

    const [row] = await t.db.selectFrom("inbox").selectAll().execute();
    expect(row?.error).toBe("rate limited");
  });

  it("delivers the held event once Slack answers again", async () => {
    t.slack.postError = new Error("slack_unavailable");
    await postWebhook(t.app, opened, { webhookUuid: "wh-1" });
    await drainWorker(t.worker);

    t.slack.postError = null;
    // The retry is behind a backoff, so claim with a clock past it.
    await t.db
      .updateTable("inbox")
      .set({ next_attempt_at: null })
      .where("webhook_uuid", "=", "wh-1")
      .execute();
    await drainWorker(t.worker);

    expect(t.slack.filter("postParent")).toHaveLength(1);
    expect(await countPending(t.db)).toBe(0);
  });
});

describe("an MR whose first event is not `open`", () => {
  const log = pino({ level: "silent" });

  beforeEach(async () => {
    t = await createTestApp({ log });
  });

  it("still opens the thread, with no author to mention", async () => {
    await postWebhook(t.app, approval, { webhookUuid: "wh-late" });
    await drainWorker(t.worker);

    expect(t.slack.filter("postParent")).toHaveLength(1);
    const row = await threadRow(t);
    // `user` on an approval is the approver, so there is nobody to record as author.
    expect(row.author_username).toBeNull();
    expect(row.author_name).toBe("Example Reviewer");
  });

  // The thread is created either way, so the log line is the only trace that an
  // event went missing. Losing it silently is how a gap stays undiagnosed.
  it("says in the log that an event was probably missed", async () => {
    const warn = vi.spyOn(log, "warn");

    await postWebhook(t.app, approval, { webhookUuid: "wh-late" });
    await drainWorker(t.worker);

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "approval", mrIid: 551 }),
      "worker: first event for MR is not 'open'; creating thread anyway",
    );
    warn.mockRestore();
  });

  it("stays quiet when the first event is a normal `open`", async () => {
    const warn = vi.spyOn(log, "warn");

    await postWebhook(t.app, opened, { webhookUuid: "wh-open" });
    await drainWorker(t.worker);

    // The directory logs its own warning for an unmatched user, so this checks
    // for the missed-event line specifically.
    expect(warn).not.toHaveBeenCalledWith(
      expect.anything(),
      "worker: first event for MR is not 'open'; creating thread anyway",
    );
    warn.mockRestore();
  });
});

describe("a stored thread that drifted from its rendered parent", () => {
  beforeEach(async () => {
    t = await createTestApp();
  });

  // Defensive path: the parent blocks are already right, but the row that
  // records the status is stale, so the next event must repair it silently.
  it("repairs the row without touching Slack", async () => {
    await postWebhook(t.app, opened, { webhookUuid: "wh-1" });
    await drainWorker(t.worker);
    t.slack.calls.length = 0;

    await t.db.updateTable("mr_threads").set({ status: "draft" }).execute();

    await postWebhook(t.app, draftOff, { webhookUuid: "wh-2" });
    await drainWorker(t.worker);

    expect((await threadRow(t)).status).toBe("open");
    expect(t.slack.filter("updateParent")).toHaveLength(0);
    expect(t.slack.filter("postReply")).toHaveLength(1);
  });

  it("repairs a counter that drifted out of range", async () => {
    await postWebhook(t.app, opened, { webhookUuid: "wh-1" });
    await drainWorker(t.worker);
    t.slack.calls.length = 0;

    // Any count below zero renders exactly like zero, so this is the one drift
    // that leaves the parent correct and the row wrong.
    await t.db.updateTable("mr_threads").set({ approvals_count: -3 }).execute();

    await postWebhook(t.app, noopUpdate, { webhookUuid: "wh-2" });
    await drainWorker(t.worker);

    expect((await threadRow(t)).approvals_count).toBe(0);
    expect(t.slack.filter("updateParent")).toHaveLength(0);
  });

  it("does not record a skip for an event that did change the parent", async () => {
    await postWebhook(t.app, opened, { webhookUuid: "wh-1" });
    await drainWorker(t.worker);

    // `reopen` carries no reply text, so the reply branch is reached by an event
    // that nevertheless rewrote the parent.
    const renamed = {
      ...opened,
      object_attributes: {
        ...opened.object_attributes,
        action: "reopen",
        title: "[SD-36717] Renamed while reopening",
      },
    };
    await postWebhook(t.app, renamed, { webhookUuid: "wh-2" });
    await drainWorker(t.worker);

    const second = (await auditRows(t)).filter((r) => r.correlation_id === "wh-2");
    expect(second.map((r) => r.slack_action)).toEqual(["update_parent"]);
  });
});

describe("approvals adding up", () => {
  beforeEach(async () => {
    t = await createTestApp();
  });

  it("counts every approval, not just the last one", async () => {
    await postWebhook(t.app, opened, { webhookUuid: "wh-1" });
    await postWebhook(t.app, approval, { webhookUuid: "wh-2" });
    await postWebhook(t.app, approval, { webhookUuid: "wh-3" });
    await drainWorker(t.worker);

    expect((await threadRow(t)).approvals_count).toBe(2);
    const updates = t.slack.filter("updateParent");
    expect(JSON.stringify(updates[updates.length - 1])).toContain("👍 2 approved");
  });
});

describe("what the payload says about the project", () => {
  beforeEach(async () => {
    t = await createTestApp();
  });

  it("records the name GitLab sent", async () => {
    const named = { ...opened, project: { ...opened.project, name: "api-gateway" } };

    await postWebhook(t.app, named, { webhookUuid: "wh-1" });
    await drainWorker(t.worker);

    expect((await listProjects(t.db))[0]).toMatchObject({
      name: "api-gateway",
      web_url: "https://gitlab.example.com/example/project",
    });
  });

  // GitLab sends `"description": null` for an MR with an empty body, and omits
  // the field entirely on some older versions. Both must reach the ticket search.
  it.each([
    ["null", null],
    ["missing", undefined],
  ])("copes with a description that is %s", async (_name, description) => {
    const { description: _dropped, ...rest } = opened.object_attributes;
    const attrs = description === undefined ? rest : { ...rest, description };

    await postWebhook(t.app, { ...opened, object_attributes: attrs }, { webhookUuid: "wh-1" });
    await drainWorker(t.worker);

    expect(t.slack.filter("postParent")).toHaveLength(1);
    expect((await threadRow(t)).jira_key).toBe("SD-36717");
  });
});

describe("the Jira address", () => {
  it("turns the ticket key in the eyebrow into a link", async () => {
    t = await createTestApp({ jiraBaseUrl: "https://jira.example.com" });

    await postWebhook(t.app, opened, { webhookUuid: "wh-1" });
    await drainWorker(t.worker);

    expect(JSON.stringify(t.slack.filter("postParent")[0])).toContain(
      "<https://jira.example.com/browse/SD-36717|SD-36717>",
    );
  });

  it("shows the bare key when no address is set", async () => {
    t = await createTestApp();

    await postWebhook(t.app, opened, { webhookUuid: "wh-1" });
    await drainWorker(t.worker);

    const parent = JSON.stringify(t.slack.filter("postParent")[0]);
    expect(parent).toContain("SD-36717");
    expect(parent).not.toContain("browse/SD-36717");
  });
});

describe("mentions switched off in the panel", () => {
  it("posts the author as a plain name and drops the reviewer line", async () => {
    t = await createTestApp({
      slackUsers: [
        { id: "U_JAN", handle: "jan.kowalski", displayName: "" },
        { id: "U_ANNA", handle: "anna.nowak", displayName: "" },
      ],
    });
    await t.settings.write({ mentions_enabled: false }, SEEDER);

    await postWebhook(t.app, openedReviewers, { webhookUuid: "wh-1" });
    await drainWorker(t.worker);

    const parent = JSON.stringify(t.slack.filter("postParent")[0]);
    expect(parent).toContain("Jan Kowalski");
    expect(parent).not.toContain("<@U_JAN>");
    expect(parent).not.toContain("<@U_ANNA>");
    // With mentions off there are no reviewer mentions to render, so the whole
    // line goes rather than degrading to plain names.
    expect(parent).not.toContain("Reviewers:");
  });
});
