import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("audit_log")
    .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
    .addColumn("correlation_id", "text", (c) => c.notNull())
    .addColumn("project_id", "integer")
    .addColumn("mr_iid", "integer")
    .addColumn("action", "text", (c) => c.notNull())
    .addColumn("slack_action", "text", (c) => c.notNull())
    .addColumn("slack_ts", "text")
    .addColumn("at", "text", (c) => c.notNull())
    .execute();

  await sql`CREATE INDEX idx_audit_corr ON audit_log(correlation_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("audit_log").execute();
}
