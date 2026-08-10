import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { registerWebhookRoute } from "./webhook.js";
import { registerHealthRoute } from "./health.js";
import { registerSimulatorRoute } from "./simulator.js";
import type { KyselyDb } from "../db/index.js";
import type { Logger } from "../logger.js";

export type BuildAppDeps = {
  db: KyselyDb;
  log: Logger;
  gitlabWebhookSecret: string;
  devSimulator?: boolean;
};

export function buildApp(deps: BuildAppDeps): FastifyInstance {
  const app = Fastify({
    loggerInstance: deps.log,
    bodyLimit: 2 * 1024 * 1024, // 2 MiB, generous for MR payloads
  });

  // Cast needed because pino's Logger.child() returns Logger (not FastifyBaseLogger),
  // making FastifyInstance<...,Logger,...> structurally incompatible with the default
  // FastifyInstance<...,FastifyBaseLogger,...> that the route helpers expect.
  const baseApp = app as unknown as FastifyInstance;

  registerHealthRoute(baseApp, deps.db);
  registerWebhookRoute(baseApp, {
    db: deps.db,
    log: deps.log,
    gitlabWebhookSecret: deps.gitlabWebhookSecret,
  });
  if (deps.devSimulator) registerSimulatorRoute(baseApp);

  return baseApp;
}
