import type { FastifyInstance } from "fastify";
import { countPending, countFailed, oldestPendingAgeMs } from "../persistence/inbox.js";
import type { KyselyDb } from "../db/index.js";

export function registerHealthRoute(app: FastifyInstance, db: KyselyDb): void {
  app.get("/healthz", async () => {
    const [pending, failed, oldestAge] = await Promise.all([
      countPending(db),
      countFailed(db),
      oldestPendingAgeMs(db),
    ]);
    return {
      ok: true,
      inbox_pending: pending,
      inbox_failed: failed,
      oldest_pending_age_ms: oldestAge,
    };
  });
}
