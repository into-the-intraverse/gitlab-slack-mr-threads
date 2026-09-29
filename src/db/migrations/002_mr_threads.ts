import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("mr_threads")
    .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
    .addColumn("project_id", "integer", (c) => c.notNull())
    .addColumn("mr_iid", "integer", (c) => c.notNull())
    .addColumn("slack_channel_id", "text", (c) => c.notNull())
    .addColumn("slack_thread_ts", "text", (c) => c.notNull())
    .addColumn("jira_key", "text")
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("author_name", "text", (c) => c.notNull())
    .addColumn("source_branch", "text", (c) => c.notNull())
    .addColumn("target_branch", "text", (c) => c.notNull())
    .addColumn("web_url", "text", (c) => c.notNull())
    .addColumn("status", "text", (c) => c.notNull())
    .addColumn("approvals_count", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("last_parent_hash", "text", (c) => c.notNull())
    .addColumn("created_at", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();

  await sql`CREATE UNIQUE INDEX idx_mr_threads_identity ON mr_threads(project_id, mr_iid)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("mr_threads").execute();
}
