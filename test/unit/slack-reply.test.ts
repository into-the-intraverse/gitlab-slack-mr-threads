import { describe, expect, it } from "vitest";
import { renderReplyText } from "../../src/slack/reply.js";
import type { MergeRequestEvent } from "../../src/gitlab/types.js";

const evt = (
  action: MergeRequestEvent["object_attributes"]["action"],
  over: Partial<MergeRequestEvent["object_attributes"]> = {},
  changes: MergeRequestEvent["changes"] = undefined,
  user = { name: "Alex", username: "alex" },
): MergeRequestEvent =>
  ({
    object_kind: "merge_request",
    user,
    project: { id: 1 },
    object_attributes: {
      iid: 1,
      title: "t",
      description: "",
      source_branch: "b",
      target_branch: "master",
      url: "https://example.com/mr/1",
      state: "opened",
      action,
      draft: false,
      ...over,
    },
    changes,
  }) as MergeRequestEvent;

describe("renderReplyText", () => {
  it("open → null (no reply, parent is the signal)", () => {
    expect(renderReplyText(evt("open"))).toBeNull();
  });

  it("draft on", () => {
    expect(
      renderReplyText(evt("update", {}, { draft: { previous: false, current: true } })),
    ).toBe("📝 Marked as draft");
  });

  it("draft off", () => {
    expect(
      renderReplyText(evt("update", {}, { draft: { previous: true, current: false } })),
    ).toBe("🟢 Ready for review");
  });

  it("approval with name", () => {
    expect(renderReplyText(evt("approval", {}, undefined, { name: "Jan", username: "j" }))).toBe(
      "👍 Approved by Jan",
    );
  });

  it("unapproval with name", () => {
    expect(
      renderReplyText(evt("unapproval", {}, undefined, { name: "Jan", username: "j" })),
    ).toBe("↩️ Approval revoked by Jan");
  });

  it("approved quorum", () => {
    expect(renderReplyText(evt("approved"))).toBe("✅ All required approvals received");
  });

  it("merge uses target_branch", () => {
    expect(renderReplyText(evt("merge", { target_branch: "master" }))).toBe(
      "🟣 Merged into `master`",
    );
  });

  it("close", () => {
    expect(renderReplyText(evt("close"))).toBe("⚫ Closed without merge");
  });

  it("update without draft change → null", () => {
    expect(renderReplyText(evt("update"))).toBeNull();
  });

  it("reopen → null in v1", () => {
    expect(renderReplyText(evt("reopen"))).toBeNull();
  });
});
