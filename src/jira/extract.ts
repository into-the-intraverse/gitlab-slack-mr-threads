export function extractJiraKey(
  regex: RegExp,
  title: string,
  sourceBranch: string,
  description: string,
): string | null {
  for (const source of [title, sourceBranch, description]) {
    const match = source.match(regex);
    if (match) return match[0];
  }
  return null;
}
