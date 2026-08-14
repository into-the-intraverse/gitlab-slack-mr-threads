import type { Kysely } from "kysely";

// Bot settings move out of env and into the database so they can be edited from
// Slack without a restart. Values are JSON-encoded so a string, a boolean and an
// object can share one column, and a missing row simply means "use the default"
// — a fresh install needs no seed.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("settings")
    .addColumn("key", "text", (c) => c.primaryKey())
    .addColumn("value", "text", (c) => c.notNull())
    .addColumn("updated_at", "text", (c) => c.notNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("settings").execute();
}
