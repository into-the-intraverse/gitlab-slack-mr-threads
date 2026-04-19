import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { openDb, type KyselyDb } from "../../src/db/index.js";
import { migrateToLatest } from "../../src/db/migrate.js";
import { buildApp } from "../../src/server/app.js";
import { makeWorker, type Worker } from "../../src/worker/worker.js";
import type { FastifyInstance } from "fastify";
import { FakeSlackClient } from "./fake-slack.js";

export type TestApp = {
  app: FastifyInstance;
  worker: Worker;
  db: KyselyDb;
  slack: FakeSlackClient;
  dbPath: string;
  cleanup: () => Promise<void>;
};

const SECRET = "test-secret";
const DEFAULT_CHANNEL = "C-DEFAULT";

export async function createTestApp(opts?: {
  dbPath?: string;
  enabledProjectIds?: number[];
  projectChannelMap?: Record<number, string>;
}): Promise<TestApp> {
  // The DB lives in its own tmpdir so that cleanup() can close resources
  // without deleting the DB file — this enables the restart-recovery test to
  // pass a dbPath from a previous app instance without the file being wiped.
  const ownedDbDir = opts?.dbPath ? null : mkdtempSync(join(tmpdir(), "glsp-db-"));
  const dbPath = opts?.dbPath ?? join(ownedDbDir!, "test.db");
  const { db } = openDb(`file:${dbPath}`);

  const here = dirname(fileURLToPath(import.meta.url));
  const folder = resolve(here, "../../migrations");
  await migrateToLatest(db, folder);

  const log = pino({ level: "silent" });
  const slack = new FakeSlackClient();
  const worker = makeWorker({
    db,
    slack,
    log,
    jiraKeyRegex: /[A-Z][A-Z0-9]+-\d+/,
    slackDefaultChannelId: DEFAULT_CHANNEL,
    projectChannelMap: opts?.projectChannelMap ?? {},
    enabledProjectIds: opts?.enabledProjectIds ?? [],
  });
  const app = buildApp({ db, log, gitlabWebhookSecret: SECRET });
  await app.ready();

  return {
    app,
    worker,
    db,
    slack,
    dbPath,
    async cleanup() {
      await worker.stop();
      await app.close();
      await db.destroy();
      // DB tmpdir is intentionally NOT deleted here so that a caller-provided
      // dbPath (restart test) can be reused across app instances.  The OS will
      // clean up the glsp-db-* tmpdirs at reboot / tmpdir rotation.
    },
  };
}

export const TEST_SECRET = SECRET;
export const TEST_DEFAULT_CHANNEL = DEFAULT_CHANNEL;

export async function postWebhook(
  app: FastifyInstance,
  payload: object,
  opts: { webhookUuid: string; eventUuid?: string; token?: string } = {
    webhookUuid: "wh-1",
  },
) {
  return app.inject({
    method: "POST",
    url: "/webhooks/gitlab",
    headers: {
      "content-type": "application/json",
      "x-gitlab-token": opts.token ?? SECRET,
      "x-gitlab-event": "Merge Request Hook",
      "x-gitlab-webhook-uuid": opts.webhookUuid,
      ...(opts.eventUuid ? { "x-gitlab-event-uuid": opts.eventUuid } : {}),
    },
    payload,
  });
}

export async function drainWorker(worker: Worker): Promise<void> {
  // Process until there's nothing left.
  for (let i = 0; i < 1000; i++) {
    const didWork = await worker.processOnce();
    if (!didWork) return;
  }
  throw new Error("worker did not drain after 1000 iterations");
}
