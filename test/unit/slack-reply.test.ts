import { describe, expect, it } from "vitest";
import { STATUS_EMOJI } from "../../src/slack/blocks.js";
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
    ).toBe("👀 Ready for review");
  });

  it("all threads resolved", () => {
    expect(
      renderReplyText(
        evt("update", {}, { blocking_discussions_resolved: { previous: false, current: true } }),
      ),
    ).toBe("🧵 All threads resolved");
  });

  it("threads becoming unresolved is not reported", () => {
    expect(
      renderReplyText(
        evt("update", {}, { blocking_discussions_resolved: { previous: true, current: false } }),
      ),
    ).toBeNull();
  });

  it("a draft toggle wins over a simultaneous thread resolution", () => {
    expect(
      renderReplyText(
        evt("update", {}, {
          draft: { previous: true, current: false },
          blocking_discussions_resolved: { previous: false, current: true },
        }),
      ),
    ).toBe("👀 Ready for review");
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

  it("unapproved quorum", () => {
    expect(renderReplyText(evt("unapproved"))).toBe(
      "⚠️ Approval quorum lost — needs review again",
    );
  });

  it("merge uses target_branch", () => {
    expect(renderReplyText(evt("merge", { target_branch: "master" }))).toBe(
      "🔀 Merged into `master`",
    );
  });

  it("close", () => {
    expect(renderReplyText(evt("close"))).toBe("🚫 Closed without merge");
  });

  // One vocabulary: an event that lands the MR in a state opens with that
  // state's glyph. Read off STATUS_EMOJI so the pairing cannot drift.
  it.each([
    ["marked draft", evt("update", {}, { draft: { previous: false, current: true } }), "draft"],
    ["ready for review", evt("update", {}, { draft: { previous: true, current: false } }), "open"],
    ["quorum reached", evt("approved"), "approved"],
    ["merged", evt("merge"), "merged"],
    ["closed", evt("close"), "closed"],
  ] as const)("%s reply opens with the glyph of the state it produces", (_name, event, status) => {
    expect(renderReplyText(event)?.startsWith(STATUS_EMOJI[status])).toBe(true);
  });

  it("events that change no state keep glyphs of their own", () => {
    const stateGlyphs = new Set(Object.values(STATUS_EMOJI));
    const nonTransitions = [
      renderReplyText(evt("approval")),
      renderReplyText(evt("unapproval")),
      renderReplyText(evt("unapproved")),
      renderReplyText(
        evt("update", {}, { blocking_discussions_resolved: { previous: false, current: true } }),
      ),
    ].filter((r): r is string => r !== null);

    expect(nonTransitions).toHaveLength(4);
    for (const reply of nonTransitions) {
      expect(stateGlyphs.has([...reply][0])).toBe(false);
    }
  });

  it("update without draft change → null", () => {
    expect(renderReplyText(evt("update"))).toBeNull();
  });

  it("reopen → null in v1", () => {
    expect(renderReplyText(evt("reopen"))).toBeNull();
  });
});
