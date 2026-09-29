import { timingSafeEqual } from "node:crypto";

export function verifyGitlabToken(
  headerValue: string | undefined,
  expected: string,
): boolean {
  // An empty string is already falsy, so this covers both missing and empty.
  if (!headerValue) return false;
  const a = Buffer.from(headerValue, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
