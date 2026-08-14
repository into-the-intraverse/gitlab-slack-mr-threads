import { type Kysely, sql } from "kysely";

// `audit_log` is shaped for MR events (correlation_id, mr_iid, slack_ts) and has
// no column for who did something, so settings changes get their own table
// rather than a row where most columns are null.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("settings_audit")
    .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
    .addColumn("at", "text", (c) => c.notNull())
    .addColumn("actor_user_id", "text", (c) => c.notNull())
    .addColumn("actor_name", "text", (c) => c.notNull())
    .addColumn("scope", "text", (c) => c.notNull())
    .addColumn("key", "text", (c) => c.notNull())
    .addColumn("old_value", "text")
    .addColumn("new_value", "text")
    .execute();

  await sql`CREATE INDEX idx_settings_audit_at ON settings_audit(at DESC)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("settings_audit").execute();
}
