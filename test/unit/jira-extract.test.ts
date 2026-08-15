import { describe, expect, it } from "vitest";
import { extractJiraKey } from "../../src/jira/extract.js";

// Mirrors how the settings store compiles `jira_key_regex` — always with the `i` flag.
const RE = /[A-Z][A-Z0-9]+-\d+/i;

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

  it("accepts a lowercase key and normalises it to upper case", () => {
    expect(extractJiraKey(RE, "abc-1234 fix the thing", "x", "y")).toBe("ABC-1234");
  });

  it("normalises mixed case too", () => {
    expect(extractJiraKey(RE, "Abc-1234", "x", "y")).toBe("ABC-1234");
  });

  it("finds a lowercase key in the branch and description as well", () => {
    expect(extractJiraKey(RE, "no key", "feature/sd-2-thing", "body")).toBe("SD-2");
    expect(extractJiraKey(RE, "no key", "feature/none", "refs abc-7 here")).toBe("ABC-7");
  });

  it("gives the same key regardless of how it was typed", () => {
    const variants = ["abc-1234", "ABC-1234", "Abc-1234", "[abc-1234] title"];
    const keys = variants.map((v) => extractJiraKey(RE, v, "x", "y"));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("ABC-1234");
  });

  it("requires numeric suffix", () => {
    expect(extractJiraKey(RE, "SD-abc", "x", "y")).toBeNull();
  });

  it("accepts keys with numbers in project code", () => {
    expect(extractJiraKey(RE, "", "feature/A1B-10", "")).toBe("A1B-10");
  });
});
