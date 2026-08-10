import type { KyselyDb } from "../db/index.js";
import type { MrStatus } from "../state/derive.js";

export type MrThreadInsert = {
  project_id: number;
  mr_iid: number;
  slack_channel_id: string;
  slack_thread_ts: string;
  jira_key: string | null;
  title: string;
  author_name: string;
  author_username: string | null;
  source_branch: string;
  target_branch: string;
  web_url: string;
  status: MrStatus;
  last_parent_hash: string;
};

export type MrThreadUpdate = Partial<{
  title: string;
  source_branch: string;
  target_branch: string;
  status: MrStatus;
  approvals_count: number;
  last_parent_hash: string;
}>;

export async function getMrThread(db: KyselyDb, projectId: number, mrIid: number) {
  return await db
    .selectFrom("mr_threads")
    .selectAll()
    .where("project_id", "=", projectId)
    .where("mr_iid", "=", mrIid)
    .executeTakeFirst();
}

export async function insertMrThread(db: KyselyDb, row: MrThreadInsert): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insertInto("mr_threads")
    .values({
      ...row,
      created_at: now,
      updated_at: now,
    })
    .execute();
}

export async function updateMrThread(
  db: KyselyDb,
  projectId: number,
  mrIid: number,
  patch: MrThreadUpdate,
): Promise<void> {
  await db
    .updateTable("mr_threads")
    .set({ ...patch, updated_at: new Date().toISOString() })
    .where("project_id", "=", projectId)
    .where("mr_iid", "=", mrIid)
    .execute();
}
