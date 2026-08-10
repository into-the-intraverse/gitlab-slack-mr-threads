import { afterEach, beforeEach, describe, expect, it } from "vitest";
import approval from "../fixtures/gitlab/mr_approval.json";
import opened from "../fixtures/gitlab/mr_opened.json";
import openedReviewers from "../fixtures/gitlab/mr_opened_reviewers.json";
import { type TestApp, createTestApp, drainWorker, postWebhook } from "../helpers/test-app.js";

const SLACK_USERS = [
  { id: "U_JAN", handle: "jan.kowalski", displayName: "" },
  { id: "U_ANNA", handle: "anna.nowak", displayName: "" },
];

const metaLine = (call: unknown): string => {
  const blocks = (call as { blocks: Array<{ elements?: Array<{ text: string }> }> }).blocks;
  return blocks[2]?.elements?.[0]?.text ?? "";
};

let t: TestApp;
afterEach(async () => {
  await t.cleanup();
});

describe("Slack mentions", () => {
  beforeEach(async () => {
    t = await createTestApp({ slackUsers: SLACK_USERS });
  });

  it("mentions the author and reviewers in the parent message", async () => {
    await postWebhook(t.app, openedReviewers, { webhookUuid: "wh-1" });
    await drainWorker(t.worker);

    const [parent] = t.slack.filter("postParent");
    const line = metaLine(parent);

    // Author becomes a real mention, so posting the parent notifies them.
    expect(line).toContain("<@U_JAN>  ·  ");
    expect(line).toContain("Reviewers: <@U_ANNA>");
    // Nobody matched ghost.user, so it stays readable but silent.
    expect(line).toContain("Ghost User");
    expect(line).not.toContain("<@ghost.user>");
  });

  it("omits the reviewers line when the payload has none", async () => {
    await postWebhook(t.app, opened, { webhookUuid: "wh-1" });
    await drainWorker(t.worker);

    expect(metaLine(t.slack.filter("postParent")[0])).not.toContain("Reviewers:");
  });

  it("keeps the MR author after an event triggered by someone else", async () => {
    await postWebhook(t.app, opened, { webhookUuid: "wh-o" });
    await postWebhook(t.app, approval, { webhookUuid: "wh-a" });
    await drainWorker(t.worker);

    const updates = t.slack.filter("updateParent");
    const line = metaLine(updates[updates.length - 1]);
    expect(line).toContain("Example Author");
    expect(line).not.toContain("Example Reviewer");
  });
});

describe("Slack mentions with an explicit override", () => {
  beforeEach(async () => {
    t = await createTestApp({
      slackUsers: SLACK_USERS,
      slackUserMap: { "ghost.user": "U_GHOST" },
    });
  });

  it("uses the mapped id for a user Slack could not match", async () => {
    await postWebhook(t.app, openedReviewers, { webhookUuid: "wh-1" });
    await drainWorker(t.worker);

    expect(metaLine(t.slack.filter("postParent")[0])).toContain(
      "Reviewers: <@U_ANNA> · <@U_GHOST>",
    );
  });
});
