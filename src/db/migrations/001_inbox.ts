import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("inbox")
    .addColumn("webhook_uuid", "text", (c) => c.primaryKey())
    .addColumn("event_uuid", "text")
    .addColumn("received_at", "text", (c) => c.notNull())
    .addColumn("processed_at", "text")
    .addColumn("next_attempt_at", "text")
    .addColumn("payload_json", "text", (c) => c.notNull())
    .addColumn("error", "text")
    .addColumn("attempts", "integer", (c) => c.notNull().defaultTo(0))
    .execute();

  await sql`CREATE INDEX idx_inbox_pending ON inbox(processed_at, next_attempt_at, received_at)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("inbox").execute();
}
