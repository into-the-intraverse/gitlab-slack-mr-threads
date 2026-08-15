import { loadConfig } from "./config.js";
import { makeLogger } from "./logger.js";
import { openDb } from "./db/index.js";
import { migrateToLatest } from "./db/migrate.js";
import { buildApp } from "./server/app.js";
import { makeRealSlackClient } from "./slack/client.js";
import { makeSlackDirectory } from "./slack/directory.js";
import { makeSettingsStore } from "./settings/store.js";
import { makeWorker } from "./worker/worker.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

async function main(): Promise<void> {
  const cfg = loadConfig(process.env);
  const log = makeLogger(cfg);
  const { db } = openDb(cfg.databaseUrl);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.resolve(here, "../migrations");
  await migrateToLatest(db, migrationsFolder);
  log.info("db migrated");

  const settings = makeSettingsStore(db);
  const slack = makeRealSlackClient(cfg.slackBotToken);

  // Always constructed: `mentions_enabled` is a hot setting, so the index has to
  // already be warm when someone switches mentions back on from the panel.
  const directory = makeSlackDirectory({ slack, log, overrides: (await settings.read()).user_map });
  await directory.refresh();
  directory.start(cfg.slackDirectoryRefreshMs);

  const worker = makeWorker({ db, slack, directory, log, settings });
  worker.start(cfg.workerPollMs);
  log.info({ pollMs: cfg.workerPollMs }, "worker started");

  const app = buildApp({
    db,
    log,
    gitlabWebhookSecret: cfg.gitlabWebhookSecret,
    devSimulator: cfg.devSimulator,
  });
  if (cfg.devSimulator) log.warn("dev simulator enabled at GET /dev/simulator");

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    directory.stop();
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

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
