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

const eyebrow = (blocks: unknown[]): string =>
  (blocks[0] as { elements: Array<{ text: string }> }).elements[0].text;
const headline = (blocks: unknown[]): string => (blocks[1] as { text: { text: string } }).text.text;
const byline = (blocks: unknown[]): string =>
  (blocks[2] as { elements: Array<{ text: string }> }).elements[0].text;

describe("renderParentBlocks", () => {
  it("renders open status with jira key", () => {
    const { blocks, text } = renderParentBlocks(base);
    expect(text).toBe("[SD-36717] GitLab ↔ Slack integration — Open");
    expect(eyebrow(blocks)).toContain("👀");
    expect(eyebrow(blocks)).toContain("Open");
    expect(eyebrow(blocks)).toContain("!551");
  });

  it("puts the eyebrow and byline in the small muted tier, the headline in the body tier", () => {
    const { blocks } = renderParentBlocks(base);
    expect((blocks[0] as { type: string }).type).toBe("context");
    expect((blocks[1] as { type: string }).type).toBe("section");
    expect((blocks[2] as { type: string }).type).toBe("context");
    // Exactly one body-size line, so the title is unambiguously the headline.
    expect(blocks.filter((b) => (b as { type: string }).type === "section")).toHaveLength(1);
  });

  it("links the MR number to the merge request", () => {
    expect(eyebrow(renderParentBlocks(base).blocks)).toBe(
      "👀 Open  ·  <https://gitlab.example.com/proj/-/merge_requests/551|!551>  ·  SD-36717",
    );
  });

  it("links the ticket when a Jira address is configured", () => {
    const { blocks } = renderParentBlocks({
      ...base,
      jiraUrl: "https://jira.example.com/browse/SD-36717",
    });
    expect(eyebrow(blocks)).toContain("<https://jira.example.com/browse/SD-36717|SD-36717>");
  });

  it("gives every status its own glyph", () => {
    const statuses = ["draft", "open", "approved", "merged", "closed"] as const;
    const emojis = statuses.map((status) => {
      const { blocks } = renderParentBlocks({ ...base, status });
      return eyebrow(blocks).split(" ")[0];
    });
    expect(new Set(emojis).size).toBe(statuses.length);
  });

  it("renders exactly three blocks and no View MR footer", () => {
    const { blocks } = renderParentBlocks(base);
    expect(blocks).toHaveLength(3);
    expect(JSON.stringify(blocks)).not.toContain("View MR");
  });

  it("gives the branch pair a line of its own, below the people", () => {
    const { blocks } = renderParentBlocks({
      ...base,
      reviewerMentions: ["Anna Nowak", "Piotr Zielinski"],
      approvalsCount: 2,
    });
    const [people, branches] = byline(blocks).split("\n");
    expect(people).toBe(
      "Example Author  ·  Reviewers: Anna Nowak · Piotr Zielinski  ·  👍 2 approved",
    );
    expect(branches).toBe("`feature/SD-36717-slack-threading` → `master`");
  });

  it("keeps the branch line when there is nothing else to show", () => {
    const [people, branches] = byline(renderParentBlocks(base).blocks).split("\n");
    expect(people).toBe("Example Author");
    expect(branches).toBe("`feature/SD-36717-slack-threading` → `master`");
  });

  it("always shows the target branch, even when it is the default one", () => {
    for (const targetBranch of ["master", "main", "release/2026-08"]) {
      const { blocks } = renderParentBlocks({ ...base, targetBranch });
      expect(byline(blocks)).toContain(`→ \`${targetBranch}\``);
    }
  });

  it("separates reviewers so the names do not run together", () => {
    const { blocks } = renderParentBlocks({
      ...base,
      reviewerMentions: ["Example Reviewer1", "Example Reviewer2"],
    });
    expect(byline(blocks)).toContain("Reviewers: Example Reviewer1 · Example Reviewer2");
  });

  it("mentions the jira key once when the title already carries it", () => {
    const { blocks, text } = renderParentBlocks({
      ...base,
      title: "[SD-36717] GitLab ↔ Slack integration",
    });
    expect(eyebrow(blocks)).toContain("SD-36717");
    // The branch line legitimately repeats the key, the headline must not.
    expect(headline(blocks)).not.toContain("SD-36717");
    expect(text).toBe("[SD-36717] GitLab ↔ Slack integration — Open");
  });

  it("strips 'KEY:' and 'KEY -' title prefixes too", () => {
    for (const title of ["SD-36717: Fix thing", "SD-36717 - Fix thing", "[SD-36717]Fix thing"]) {
      const { blocks } = renderParentBlocks({ ...base, title });
      expect(headline(blocks)).toBe(
        "*<https://gitlab.example.com/proj/-/merge_requests/551|Fix thing>*",
      );
    }
  });

  // GitLab keeps whatever whitespace the author typed; the headline must not.
  it("trims a padded title, with a ticket key and without one", () => {
    const padded = { ...base, title: "  Make the thing faster  " };
    expect(headline(renderParentBlocks({ ...padded, jiraKey: null }).blocks)).toContain(
      "|Make the thing faster>",
    );
    expect(renderParentBlocks({ ...padded, jiraKey: null }).text).toBe(
      "[NO-JIRA] Make the thing faster — Open",
    );
    // With a key that is not in the title, stripping finds nothing to remove.
    expect(renderParentBlocks(padded).text).toBe("[SD-36717] Make the thing faster — Open");
  });

  it("keeps the title when it is nothing but the jira key", () => {
    const { text } = renderParentBlocks({ ...base, title: "SD-36717" });
    expect(text).toBe("[SD-36717] SD-36717 — Open");
  });

  it("says 'no ticket' in the eyebrow when no jira key was found", () => {
    const { blocks, text } = renderParentBlocks({ ...base, jiraKey: null });
    // The fallback text keeps the bracketed form — it is what notifications show.
    expect(text).toContain("[NO-JIRA]");
    expect(eyebrow(blocks)).toContain("no ticket");
  });

  it("shows approvals count when > 0", () => {
    const { blocks } = renderParentBlocks({ ...base, approvalsCount: 2 });
    expect(byline(blocks)).toContain("👍 2 approved");
  });

  it("omits the approvals count when it is 0", () => {
    expect(byline(renderParentBlocks(base).blocks)).not.toContain("👍");
  });

  it("picks correct emoji per status", () => {
    const cases: Array<["open" | "draft" | "approved" | "merged" | "closed", string]> = [
      ["draft", "📝"],
      ["open", "👀"],
      ["approved", "✅"],
      ["merged", "🔀"],
      ["closed", "🚫"],
    ];
    for (const [status, emoji] of cases) {
      expect(eyebrow(renderParentBlocks({ ...base, status }).blocks)).toContain(emoji);
    }
  });

  it("is deterministic — same input → same blocks JSON", () => {
    const a = JSON.stringify(renderParentBlocks(base).blocks);
    const b = JSON.stringify(renderParentBlocks(base).blocks);
    expect(a).toBe(b);
  });
});
