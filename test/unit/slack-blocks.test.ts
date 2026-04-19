import { describe, expect, it } from "vitest";
import { renderParentBlocks } from "../../src/slack/blocks.js";

const base = {
  status: "open" as const,
  jiraKey: "SD-36717",
  title: "GitLab ↔ Slack integration",
  mrIid: 551,
  authorName: "Example Author",
  sourceBranch: "feature/SD-36717-slack-threading",
  targetBranch: "master",
  webUrl: "https://gitlab.example.com/proj/-/merge_requests/551",
  approvalsCount: 0,
};

describe("renderParentBlocks", () => {
  it("renders open status with jira key", () => {
    const { blocks, text } = renderParentBlocks(base);
    expect(text).toBe("[SD-36717] GitLab ↔ Slack integration — Open");
    const header = blocks[0] as { type: string; text: { text: string } };
    expect(header.type).toBe("header");
    expect(header.text.text).toContain("🟢");
    expect(header.text.text).toContain("Open");
    expect(header.text.text).toContain("!551");
  });

  it("renders without jira key using NO-JIRA prefix", () => {
    const { blocks, text } = renderParentBlocks({ ...base, jiraKey: null });
    expect(text).toContain("[NO-JIRA]");
    const header = blocks[0] as { text: { text: string } };
    expect(header.text.text).toContain("[NO-JIRA]");
  });

  it("shows approvals count when > 0", () => {
    const { blocks } = renderParentBlocks({ ...base, approvalsCount: 2 });
    const serialized = JSON.stringify(blocks);
    expect(serialized).toMatch(/👍 2 approvals/);
  });

  it("omits approvals line when count is 0", () => {
    const { blocks } = renderParentBlocks(base);
    const serialized = JSON.stringify(blocks);
    expect(serialized).not.toMatch(/approvals/);
  });

  it("picks correct emoji per status", () => {
    const cases: Array<["open" | "draft" | "approved" | "merged" | "closed", string]> = [
      ["open", "🟢"],
      ["draft", "📝"],
      ["approved", "✅"],
      ["merged", "🟣"],
      ["closed", "⚫"],
    ];
    for (const [status, emoji] of cases) {
      const { blocks } = renderParentBlocks({ ...base, status });
      const header = blocks[0] as { text: { text: string } };
      expect(header.text.text).toContain(emoji);
    }
  });

  it("is deterministic — same input → same blocks JSON", () => {
    const a = JSON.stringify(renderParentBlocks(base).blocks);
    const b = JSON.stringify(renderParentBlocks(base).blocks);
    expect(a).toBe(b);
  });
});
