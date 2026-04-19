import { timingSafeEqual } from "node:crypto";

export function verifyGitlabToken(
  headerValue: string | undefined,
  expected: string,
): boolean {
  if (!headerValue || headerValue.length === 0) return false;
  const a = Buffer.from(headerValue, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
