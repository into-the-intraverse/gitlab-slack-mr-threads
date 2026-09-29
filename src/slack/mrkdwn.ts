/**
 * Escapes the three characters Slack treats as markup control characters.
 * `&` goes first, so the ampersands the other two introduce are not escaped again.
 * Never apply this to `<@U…>` mention tokens — it would turn them back into text.
 */
export function escapeMrkdwn(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
