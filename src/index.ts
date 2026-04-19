import { loadConfig } from "./config.js";
import { makeLogger } from "./logger.js";
import { openDb } from "./db/index.js";
import { migrateToLatest } from "./db/migrate.js";
import { buildApp } from "./server/app.js";
import { makeRealSlackClient } from "./slack/client.js";
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

  const slack = makeRealSlackClient(cfg.slackBotToken);
  const worker = makeWorker({
    db,
    slack,
    log,
    jiraKeyRegex: cfg.jiraKeyRegex,
    slackDefaultChannelId: cfg.slackDefaultChannelId,
    projectChannelMap: cfg.projectChannelMap,
    enabledProjectIds: cfg.enabledProjectIds,
  });
  worker.start(cfg.workerPollMs);
  log.info({ pollMs: cfg.workerPollMs }, "worker started");

  const app = buildApp({ db, log, gitlabWebhookSecret: cfg.gitlabWebhookSecret });

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
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
