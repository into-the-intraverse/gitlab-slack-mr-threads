import type { Kysely } from "kysely";

// The MR author's GitLab username is only knowable from the `open` event (later
// events carry the *triggering* user), so it is captured once and kept here.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("mr_threads").addColumn("author_username", "text").execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable("mr_threads").dropColumn("author_username").execute();
}
