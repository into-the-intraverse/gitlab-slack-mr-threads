/**
 * Escapes the three characters Slack treats as markup control characters.
 * Never apply this to `<@U…>` mention tokens — it would turn them back into text.
 */
export function escapeMrkdwn(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);
}
