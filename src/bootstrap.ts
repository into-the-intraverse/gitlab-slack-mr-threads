import { loadConfig } from "./config.js";
import { openDb } from "./db/index.js";
import { migrateToLatest } from "./db/migrate.js";
import { makeLogger } from "./logger.js";
import { buildApp } from "./server/app.js";
import { makeSettingsStore } from "./settings/store.js";
import { makeAuthz } from "./slack/authz.js";
import { makeRealSlackClient } from "./slack/client.js";
import { makeSlackDirectory } from "./slack/directory.js";
import type { HomeDeps } from "./slack/home/handlers.js";
import { routeSocketEvent } from "./slack/home/route.js";
import { type SlackSocket, makeSlackSocket } from "./slack/socket.js";
import { makeWorker } from "./worker/worker.js";

/** How long the first Slack directory load may delay the port opening. */
const DIRECTORY_WARMUP_MS = 5_000;

/** Resolves when `work` does, or after `ms`, whichever comes first. Never rejects. */
async function withTimeout(work: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    work,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  clearTimeout(timer);
}

/** Wires everything together and starts listening. `src/index.ts` only calls this. */
export async function bootstrap(): Promise<void> {
  const cfg = loadConfig(process.env);
  const log = makeLogger(cfg);
  const { db } = openDb(cfg.databaseUrl);

  await migrateToLatest(db);
  log.info("db migrated");

  const settings = makeSettingsStore(db);
  const slack = makeRealSlackClient(cfg.slackBotToken, cfg.slackApiUrl);

  // Always constructed: `mentions_enabled` is a hot setting, so the index has to
  // already be warm when someone switches mentions back on from the panel.
  const directory = makeSlackDirectory({ slack, log, overrides: (await settings.read()).user_map });
  // Warm it before serving, but on a leash. The Web API client retries a dead
  // Slack for about half an hour, and every second of that is a second in which
  // GitLab gets connection refused and burns the delivery on its own retries.
  // A cold index costs plain names on the first few messages; a closed port
  // costs events, which is the one thing this design refuses to do.
  await withTimeout(directory.refresh(), DIRECTORY_WARMUP_MS);
  directory.start(cfg.slackDirectoryRefreshMs);

  const worker = makeWorker({ db, slack, directory, log, settings });
  worker.start(cfg.workerPollMs);
  log.info({ pollMs: cfg.workerPollMs }, "worker started");

  let socket: SlackSocket | null = null;

  if (cfg.slackAppToken) {
    const homeDeps: HomeDeps = {
      db,
      slack,
      settings,
      authz: makeAuthz({ slack, log, adminUserIds: cfg.slackAdminUserIds }),
      directory,
      log,
      socketConnected: () => socket?.connected() ?? false,
    };

    socket = makeSlackSocket({
      appToken: cfg.slackAppToken,
      log,
      onEvent: (type, payload) => routeSocketEvent(homeDeps, type, payload),
    });

    await socket.start();
    log.info("slack settings panel enabled");
  } else {
    log.warn("SLACK_APP_TOKEN is not set; the settings panel is off");
  }

  const app = buildApp({
    db,
    log,
    gitlabWebhookSecret: cfg.gitlabWebhookSecret,
    devSimulator: cfg.devSimulator,
    ...(socket ? { socketConnected: () => socket?.connected() ?? false } : {}),
  });
  if (cfg.devSimulator) log.warn("dev simulator enabled at GET /dev/simulator");

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    directory.stop();
    await socket?.stop();
    await worker.stop();
    await app.close();
    await db.destroy();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ host: "0.0.0.0", port: cfg.port });
  log.info({ port: cfg.port }, "listening");
}
