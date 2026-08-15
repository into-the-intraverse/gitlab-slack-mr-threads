import type { ProjectSettings } from "./projects.js";

/**
 * Channel selection was never an HTTP concern, which is why this lives under
 * `settings/` rather than `server/`. Both functions stay pure and take the row
 * the caller has already read, so database access stays in one place.
 */
export function resolveChannel(project: ProjectSettings | null, defaultChannel: string): string {
  return project?.channel_id ?? defaultChannel;
}

/** A project nobody has configured is allowed, matching the old empty allowlist. */
export function isProjectEnabled(project: ProjectSettings | null): boolean {
  return project?.enabled ?? true;
}
