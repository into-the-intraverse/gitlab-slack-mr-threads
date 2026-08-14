import type { KyselyDb } from "../db/index.js";

export type SettingsAuditEntry = {
  at: string;
  actor_user_id: string;
  actor_name: string;
  /** `global` or `project:<id>`. */
  scope: string;
  key: string;
  old_value: string | null;
  new_value: string | null;
};

// No secret can land here by construction: secrets stay in env and never reach
// the settings tables.
export async function recordSettingsChange(db: KyselyDb, e: SettingsAuditEntry): Promise<void> {
  await db.insertInto("settings_audit").values(e).execute();
}

export async function listRecentSettingsChanges(
  db: KyselyDb,
  limit: number,
): Promise<SettingsAuditEntry[]> {
  return await db
    .selectFrom("settings_audit")
    .select(["at", "actor_user_id", "actor_name", "scope", "key", "old_value", "new_value"])
    .orderBy("id", "desc")
    .limit(limit)
    .execute();
}
