import type { Kysely } from "kysely";

// Replaces the PROJECT_CHANNEL_MAP and ENABLED_PROJECT_IDS env strings. Rows are
// discovered from webhook traffic rather than typed in by hand: a project that
// has never sent an event has nothing to route. `enabled` defaults to 1 to
// preserve the old meaning of an empty allowlist — all projects allowed.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("project_settings")
    .addColumn("project_id", "integer", (c) => c.primaryKey())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("web_url", "text", (c) => c.notNull())
    .addColumn("channel_id", "text")
    .addColumn("enabled", "integer", (c) => c.notNull().defaultTo(1))
    .addColumn("last_seen_at", "text", (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("project_settings").execute();
}
