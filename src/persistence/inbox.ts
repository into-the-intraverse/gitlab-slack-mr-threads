import type { KyselyDb } from "../db/index.js";

export const MAX_ATTEMPTS = 10;

// Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped). Caller passes post-increment attempts count.
const BACKOFF_MS_CAP = 30_000;
export function backoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(BACKOFF_MS_CAP, 1000 * 2 ** (attempts - 1));
}

export type InboxInsert = {
  webhook_uuid: string;
  event_uuid: string | null;
  payload_json: string;
};

export async function insertInboxRow(db: KyselyDb, row: InboxInsert): Promise<boolean> {
  const res = await db
    .insertInto("inbox")
    .values({
      webhook_uuid: row.webhook_uuid,
      event_uuid: row.event_uuid,
      received_at: new Date().toISOString(),
      processed_at: null,
      next_attempt_at: null,
      payload_json: row.payload_json,
      error: null,
    })
    .onConflict((oc) => oc.column("webhook_uuid").doNothing())
    .executeTakeFirst();
  return Number(res?.numInsertedOrUpdatedRows ?? 0) > 0;
}

export async function claimNextPending(db: KyselyDb, nowIso = new Date().toISOString()) {
  return await db
    .selectFrom("inbox")
    .selectAll()
    .where("processed_at", "is", null)
    .where("attempts", "<", MAX_ATTEMPTS)
    .where((eb) =>
      eb.or([eb("next_attempt_at", "is", null), eb("next_attempt_at", "<=", nowIso)]),
    )
    .orderBy("received_at", "asc")
    .limit(1)
    .executeTakeFirst();
}

export async function markProcessed(db: KyselyDb, webhookUuid: string): Promise<void> {
  await db
    .updateTable("inbox")
    .set({ processed_at: new Date().toISOString(), error: null, next_attempt_at: null })
    .where("webhook_uuid", "=", webhookUuid)
    .execute();
}

export async function markFailed(
  db: KyselyDb,
  webhookUuid: string,
  error: string,
): Promise<void> {
  // Read current attempts to compute the new next_attempt_at.
  const row = await db
    .selectFrom("inbox")
    .select(["attempts"])
    .where("webhook_uuid", "=", webhookUuid)
    .executeTakeFirst();
  const nextAttempts = (row?.attempts ?? 0) + 1;
  const nextAt = new Date(Date.now() + backoffMs(nextAttempts)).toISOString();
  await db
    .updateTable("inbox")
    .set({ attempts: nextAttempts, error, next_attempt_at: nextAt })
    .where("webhook_uuid", "=", webhookUuid)
    .execute();
}

export async function countPending(db: KyselyDb): Promise<number> {
  const row = await db
    .selectFrom("inbox")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("processed_at", "is", null)
    .where("attempts", "<", MAX_ATTEMPTS)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

export async function countFailed(db: KyselyDb): Promise<number> {
  const row = await db
    .selectFrom("inbox")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("attempts", ">=", MAX_ATTEMPTS)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

export async function oldestPendingAgeMs(db: KyselyDb): Promise<number> {
  const row = await db
    .selectFrom("inbox")
    .select("received_at")
    .where("processed_at", "is", null)
    .where("attempts", "<", MAX_ATTEMPTS)
    .orderBy("received_at", "asc")
    .limit(1)
    .executeTakeFirst();
  if (!row) return 0;
  return Date.now() - new Date(row.received_at).getTime();
}
