import { describe, expect, it } from "vitest";
import { deriveStatus } from "../../src/state/derive.js";
import type { MergeRequestEvent } from "../../src/gitlab/types.js";

type Prev = {
  status: "open" | "draft" | "approved" | "merged" | "closed";
  approvalsCount: number;
};

const evt = (
  action: MergeRequestEvent["object_attributes"]["action"],
  over: Partial<MergeRequestEvent["object_attributes"]> = {},
  changes: MergeRequestEvent["changes"] = undefined,
): MergeRequestEvent =>
  ({
    object_kind: "merge_request",
    user: { name: "u", username: "u" },
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

describe("deriveStatus", () => {
  it("open action → open", () => {
    expect(deriveStatus(evt("open"), null)).toEqual({
      status: "open",
      approvalsDelta: 0,
    });
  });

  it("open action with draft=true → draft", () => {
    expect(deriveStatus(evt("open", { draft: true }), null)).toEqual({
      status: "draft",
      approvalsDelta: 0,
    });
  });

  it("update with changes.draft.current=true → draft", () => {
    const prev: Prev = { status: "open", approvalsCount: 0 };
    expect(
      deriveStatus(
        evt("update", {}, { draft: { previous: false, current: true } }),
        prev,
      ),
    ).toEqual({ status: "draft", approvalsDelta: 0 });
  });

  it("update with changes.draft.current=false → open", () => {
    const prev: Prev = { status: "draft", approvalsCount: 0 };
    expect(
      deriveStatus(
        evt("update", {}, { draft: { previous: true, current: false } }),
        prev,
      ),
    ).toEqual({ status: "open", approvalsDelta: 0 });
  });

  it("approval action bumps count, status unchanged if not quorum", () => {
    const prev: Prev = { status: "open", approvalsCount: 0 };
    expect(deriveStatus(evt("approval"), prev)).toEqual({
      status: "open",
      approvalsDelta: +1,
    });
  });

  it("unapproval decrements count", () => {
    const prev: Prev = { status: "approved", approvalsCount: 2 };
    expect(deriveStatus(evt("unapproval"), prev)).toEqual({
      status: "approved",
      approvalsDelta: -1,
    });
  });

  it("approved quorum flips status to approved", () => {
    const prev: Prev = { status: "open", approvalsCount: 1 };
    expect(deriveStatus(evt("approved"), prev)).toEqual({
      status: "approved",
      approvalsDelta: 0,
    });
  });

  it("unapproved quorum flips back to open", () => {
    const prev: Prev = { status: "approved", approvalsCount: 0 };
    expect(deriveStatus(evt("unapproved"), prev)).toEqual({
      status: "open",
      approvalsDelta: 0,
    });
  });

  it("merge → merged", () => {
    const prev: Prev = { status: "approved", approvalsCount: 2 };
    expect(deriveStatus(evt("merge"), prev).status).toBe("merged");
  });

  it("close → closed", () => {
    const prev: Prev = { status: "open", approvalsCount: 0 };
    expect(deriveStatus(evt("close"), prev).status).toBe("closed");
  });

  it("update without changes.draft → status unchanged", () => {
    // `approved`, not `open`: an edit to a description must not undo the quorum.
    const prev: Prev = { status: "approved", approvalsCount: 2 };
    expect(deriveStatus(evt("update"), prev)).toEqual({
      status: "approved",
      approvalsDelta: 0,
    });
  });

  it("reopen is treated as no-op in v1 (returns prev status)", () => {
    const prev: Prev = { status: "closed", approvalsCount: 0 };
    expect(deriveStatus(evt("reopen"), prev).status).toBe("closed");
  });

  it("the last revoked approval drops an approved MR back to open", () => {
    const prev: Prev = { status: "approved", approvalsCount: 1 };
    expect(deriveStatus(evt("unapproval"), prev)).toEqual({
      status: "open",
      approvalsDelta: -1,
    });
  });

  // Only an *approved* MR falls back to open when its last approval goes. A draft
  // that loses one stays a draft — the count is not what decides the status here.
  it("a revoked approval below quorum leaves the status where it was", () => {
    const prev: Prev = { status: "draft", approvalsCount: 1 };
    expect(deriveStatus(evt("unapproval"), prev)).toEqual({
      status: "draft",
      approvalsDelta: -1,
    });
  });

  // A missed `open` (bot added mid-flight, or an event lost) means the first
  // event we see has no previous row to lean on. Every action must still answer.
  describe("with no previous state", () => {
    it.each([
      ["approval", { status: "open", approvalsDelta: +1 }],
      ["unapproval", { status: "open", approvalsDelta: -1 }],
      ["update", { status: "open", approvalsDelta: 0 }],
      ["reopen", { status: "open", approvalsDelta: 0 }],
    ] as const)("%s falls back to open", (action, expected) => {
      expect(deriveStatus(evt(action), null)).toEqual(expected);
    });
  });

  it("refuses an action GitLab has not documented", () => {
    expect(() => deriveStatus(evt("teleport" as never), null)).toThrow(/Unhandled action/);
  });
});
