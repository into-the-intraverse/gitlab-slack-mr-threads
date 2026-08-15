import type { FastifyInstance } from "fastify";
import { countPending, countFailed, oldestPendingAgeMs } from "../persistence/inbox.js";
import type { KyselyDb } from "../db/index.js";

export function registerHealthRoute(
  app: FastifyInstance,
  db: KyselyDb,
  socketConnected?: () => boolean,
): void {
  app.get("/healthz", async () => {
    const [pending, failed, oldestAge] = await Promise.all([
      countPending(db),
      countFailed(db),
      oldestPendingAgeMs(db),
    ]);
    return {
      // Deliberately not affected by the socket: a Slack outage costs the
      // settings UI, not webhook intake.
      ok: true,
      inbox_pending: pending,
      inbox_failed: failed,
      oldest_pending_age_ms: oldestAge,
      slack_socket_connected: socketConnected ? socketConnected() : null,
    };
  });
}
