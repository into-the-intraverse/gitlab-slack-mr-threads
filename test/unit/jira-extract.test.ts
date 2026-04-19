import { describe, expect, it } from "vitest";
import { extractJiraKey } from "../../src/jira/extract.js";

const RE = /[A-Z][A-Z0-9]+-\d+/;

describe("extractJiraKey", () => {
  it("finds key in title first", () => {
    expect(
      extractJiraKey(RE, "[SD-36717] title", "feature/other-ABC-1", "body SD-99"),
    ).toBe("SD-36717");
  });

  it("falls back to branch when title has no key", () => {
    expect(extractJiraKey(RE, "no key", "feature/SD-42-thing", "body")).toBe("SD-42");
  });

  it("falls back to description when title and branch have no key", () => {
    expect(extractJiraKey(RE, "no key", "feature/none", "refs ABC-7 here")).toBe("ABC-7");
  });

  it("returns null when no key found anywhere", () => {
    expect(extractJiraKey(RE, "no key", "feature/none", "body")).toBeNull();
  });

  it("picks first match when multiple present", () => {
    expect(extractJiraKey(RE, "SD-1 and SD-2", "x", "y")).toBe("SD-1");
  });

  it("rejects lowercase (regex is case-sensitive)", () => {
    expect(extractJiraKey(RE, "sd-1", "feature/sd-2", "sd-3")).toBeNull();
  });

  it("requires numeric suffix", () => {
    expect(extractJiraKey(RE, "SD-abc", "x", "y")).toBeNull();
  });

  it("accepts keys with numbers in project code", () => {
    expect(extractJiraKey(RE, "", "feature/A1B-10", "")).toBe("A1B-10");
  });
});
