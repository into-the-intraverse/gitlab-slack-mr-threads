import type { KyselyDb } from "../db/index.js";
import { recordSettingsChange } from "../persistence/settings-audit.js";
import type { Actor } from "./schema.js";

export type ProjectSettings = {
  project_id: number;
  name: string;
  web_url: string;
  /** NULL means "use the default channel". */
  channel_id: string | null;
  enabled: boolean;
  last_seen_at: string;
};

type Row = {
  project_id: number;
  name: string;
  web_url: string;
  channel_id: string | null;
  enabled: number;
  last_seen_at: string;
};

const COLUMNS = ["project_id", "name", "web_url", "channel_id", "enabled", "last_seen_at"] as const;

const toProject = (r: Row): ProjectSettings => ({ ...r, enabled: r.enabled === 1 });

export async function listProjects(db: KyselyDb): Promise<ProjectSettings[]> {
  const rows = await db
    .selectFrom("project_settings")
    .select(COLUMNS)
    .orderBy("name", "asc")
    .execute();
  return rows.map(toProject);
}

export async function getProject(db: KyselyDb, projectId: number): Promise<ProjectSettings | null> {
  const row = await db
    .selectFrom("project_settings")
    .select(COLUMNS)
    .where("project_id", "=", projectId)
    .executeTakeFirst();
  return row ? toProject(row) : null;
}

/**
 * Record that a project sent an event. Updates only the descriptive fields, so
 * an admin's channel and off switch survive every subsequent webhook.
 *
 * `name` and `webUrl` are optional because `src/gitlab/types.ts` parses them as
 * optional — the test fixtures carry only `project.id`.
 */
export async function touchProject(
  db: KyselyDb,
  input: { projectId: number; name?: string | undefined; webUrl?: string | undefined },
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await getProject(db, input.projectId);

  if (!existing) {
    await db
      .insertInto("project_settings")
      .values({
        project_id: input.projectId,
        name: input.name ?? `Project ${input.projectId}`,
        web_url: input.webUrl ?? "",
        channel_id: null,
        last_seen_at: now,
      })
      .execute();
    return;
  }

  // Only overwrite what the payload actually carried: a nameless event must not
  // replace a real name with the placeholder.
  await db
    .updateTable("project_settings")
    .set({
      last_seen_at: now,
      ...(input.name ? { name: input.name } : {}),
      ...(input.webUrl ? { web_url: input.webUrl } : {}),
    })
    .where("project_id", "=", input.projectId)
    .execute();
}

export async function setProjectChannel(
  db: KyselyDb,
  projectId: number,
  channelId: string | null,
  actor: Actor,
): Promise<void> {
  await applyChange(db, projectId, "channel_id", channelId, actor);
}

export async function setProjectEnabled(
  db: KyselyDb,
  projectId: number,
  enabled: boolean,
  actor: Actor,
): Promise<void> {
  await applyChange(db, projectId, "enabled", enabled, actor);
}

async function applyChange(
  db: KyselyDb,
  projectId: number,
  key: "channel_id" | "enabled",
  value: string | null | boolean,
  actor: Actor,
): Promise<void> {
  const existing = await getProject(db, projectId);
  if (!existing) throw new Error(`unknown project ${projectId}`);

  const oldValue = JSON.stringify(existing[key]);
  const newValue = JSON.stringify(value);
  if (oldValue === newValue) return;

  await db
    .updateTable("project_settings")
    .set(key === "enabled" ? { enabled: value ? 1 : 0 } : { channel_id: value as string | null })
    .where("project_id", "=", projectId)
    .execute();

  await recordSettingsChange(db, {
    at: new Date().toISOString(),
    actor_user_id: actor.userId,
    actor_name: actor.name,
    scope: `project:${projectId}`,
    key,
    old_value: oldValue,
    new_value: newValue,
  });
}
