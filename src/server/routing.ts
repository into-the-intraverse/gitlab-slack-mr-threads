export function resolveChannel(
  map: Record<number, string>,
  defaultChannel: string,
  projectId: number,
): string {
  return map[projectId] ?? defaultChannel;
}

export function isProjectEnabled(allowlist: number[], projectId: number): boolean {
  if (allowlist.length === 0) return true;
  return allowlist.includes(projectId);
}
