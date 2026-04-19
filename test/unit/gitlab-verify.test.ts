import { describe, expect, it } from "vitest";
import { verifyGitlabToken } from "../../src/gitlab/verify.js";

describe("verifyGitlabToken", () => {
  it("accepts exact match", () => {
    expect(verifyGitlabToken("abc123", "abc123")).toBe(true);
  });

  it("rejects mismatch", () => {
    expect(verifyGitlabToken("abc123", "wrong")).toBe(false);
  });

  it("rejects missing header", () => {
    expect(verifyGitlabToken(undefined, "abc123")).toBe(false);
  });

  it("rejects empty header", () => {
    expect(verifyGitlabToken("", "abc123")).toBe(false);
  });

  it("rejects mismatched length (constant-time safe)", () => {
    expect(verifyGitlabToken("abc", "abc123")).toBe(false);
  });
});
