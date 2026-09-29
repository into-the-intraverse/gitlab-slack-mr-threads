import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { openDb, type KyselyDb } from "../../src/db/index.js";
import type { Logger } from "../../src/logger.js";
import { migrateToLatest } from "../../src/db/migrate.js";
import { buildApp } from "../../src/server/app.js";
import { makeWorker, type Worker } from "../../src/worker/worker.js";
import type { FastifyInstance } from "fastify";
import { FakeSlackClient } from "./fake-slack.js";
import { makeSlackDirectory } from "../../src/slack/directory.js";
import type { SlackUser } from "../../src/slack/client.js";
import { makeSettingsStore, type SettingsStore } from "../../src/settings/store.js";
import { setProjectEnabled } from "../../src/settings/projects.js";

export type TestApp = {
  app: FastifyInstance;
  worker: Worker;
  db: KyselyDb;
  slack: FakeSlackClient;
  settings: SettingsStore;
  dbPath: string;
  setProjectOff: (projectId: number) => Promise<void>;
  cleanup: () => Promise<void>;
};

const SECRET = "test-secret";
const DEFAULT_CHANNEL = "C-DEFAULT";
const SEEDER = { userId: "U-TEST", name: "Test Setup" };

export async function createTestApp(opts?: {
  dbPath?: string;
  /** `null` boots an instance that has no default channel yet. */
  defaultChannel?: string | null;
  devSimulator?: boolean;
  slackUsers?: SlackUser[];
  slackUserMap?: Record<string, string>;
  jiraBaseUrl?: string;
  socketConnected?: () => boolean;
  /** Pass one to assert on what the bot logged; the default swallows everything. */
  log?: Logger;
}): Promise<TestApp> {
  // The DB lives in its own tmpdir so that cleanup() can close resources
  // without deleting the DB file — this enables the restart-recovery test to
  // pass a dbPath from a previous app instance without the file being wiped.
  const ownedDbDir = opts?.dbPath ? null : mkdtempSync(join(tmpdir(), "glsp-db-"));
  const dbPath = opts?.dbPath ?? join(ownedDbDir!, "test.db");
  const { db } = openDb(`file:${dbPath}`);
  await migrateToLatest(db);

  const log = opts?.log ?? pino({ level: "silent" });
  const slack = new FakeSlackClient();
  slack.users = opts?.slackUsers ?? [];

  // Settings live in the database now, so the old constructor options become
  // seed writes. `defaultChannel: null` deliberately leaves the bot unconfigured.
  const settings = makeSettingsStore(db);
  const defaultChannel = opts?.defaultChannel === undefined ? DEFAULT_CHANNEL : opts.defaultChannel;
  if (defaultChannel !== null) {
    await settings.write({ default_channel_id: defaultChannel }, SEEDER);
  }
  if (opts?.jiraBaseUrl) await settings.write({ jira_base_url: opts.jiraBaseUrl }, SEEDER);
  if (opts?.slackUserMap) await settings.write({ user_map: opts.slackUserMap }, SEEDER);

  const directory = makeSlackDirectory({
    slack,
    log,
    overrides: opts?.slackUserMap ?? {},
  });
  await directory.refresh();

  const worker = makeWorker({ db, slack, directory, log, settings });
  const app = buildApp({
    db,
    log,
    gitlabWebhookSecret: SECRET,
    devSimulator: opts?.devSimulator ?? false,
    ...(opts?.socketConnected ? { socketConnected: opts.socketConnected } : {}),
  });
  await app.ready();

  return {
    app,
    worker,
    db,
    slack,
    settings,
    dbPath,
    async setProjectOff(projectId: number) {
      await setProjectEnabled(db, projectId, false, SEEDER);
    },
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
