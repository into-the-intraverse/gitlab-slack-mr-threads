/**
 * Finds the first Jira key in title → branch → description, in that order.
 *
 * The key is upper-cased so that `abc-1234` and `ABC-1234` produce one
 * label instead of two — Jira keys are canonically upper case.
 */
export function extractJiraKey(
  regex: RegExp,
  title: string,
  sourceBranch: string,
  description: string,
): string | null {
  for (const source of [title, sourceBranch, description]) {
    const match = source.match(regex);
    if (match) return match[0].toUpperCase();
  }
  return null;
}
