import type { KyselyDb } from "../db/index.js";

export type AuditInsert = {
  correlation_id: string;
  project_id: number | null;
  mr_iid: number | null;
  action: string;
  slack_action: "post_parent" | "update_parent" | "post_reply" | "skip" | "error";
  slack_ts: string | null;
};

export async function writeAudit(db: KyselyDb, row: AuditInsert): Promise<void> {
  await db
    .insertInto("audit_log")
    .values({ ...row, at: new Date().toISOString() })
    .execute();
}
