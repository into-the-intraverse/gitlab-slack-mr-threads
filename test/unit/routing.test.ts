import { describe, expect, it } from "vitest";
import { resolveChannel, isProjectEnabled } from "../../src/server/routing.js";

describe("resolveChannel", () => {
  it("returns per-project override when set", () => {
    expect(resolveChannel({ 42: "C-P42" }, "CDEF", 42)).toBe("C-P42");
  });

  it("falls back to default", () => {
    expect(resolveChannel({ 1: "C1" }, "CDEF", 99)).toBe("CDEF");
  });
});

describe("isProjectEnabled", () => {
  it("empty allowlist allows all", () => {
    expect(isProjectEnabled([], 1)).toBe(true);
  });

  it("allowlist gates correctly", () => {
    expect(isProjectEnabled([1, 2], 1)).toBe(true);
    expect(isProjectEnabled([1, 2], 9)).toBe(false);
  });
});
