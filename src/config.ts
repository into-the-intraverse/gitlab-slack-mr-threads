import { z } from "zod";

/**
 * Env carries secrets, the deployment shape, and anything needed before the
 * database is open or that cannot be applied without a restart. Everything else
 * — routing, mentions, Jira — lives in the `settings` and `project_settings`
 * tables and is edited from the bot's App Home page.
 */
const rawSchema = z.object({
  SLACK_BOT_TOKEN: z.string().min(1, "SLACK_BOT_TOKEN required"),
  GITLAB_WEBHOOK_SECRET: z.string().min(1, "GITLAB_WEBHOOK_SECRET required"),
  GITLAB_BASE_URL: z.string().url("GITLAB_BASE_URL must be a URL"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL required"),
  PORT: z.string().optional().default("8080"),
  // Wanted exactly when something is broken, which may include the panel, and
  // read before the database is open. Stays here on purpose.
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .optional()
    .default("info"),
  // Both drive a setInterval, so a change needs a restart either way.
  WORKER_POLL_MS: z.string().optional().default("500"),
  SLACK_DIRECTORY_REFRESH_MS: z.string().optional().default("900000"),
  // Stays out of the database on purpose: an admin who could edit this list
  // could grant themselves permanent access, so it belongs to whoever runs the
  // deployment.
  SLACK_ADMIN_USER_IDS: z.string().optional().default(""),
  // Empty means "no settings panel", so the bot still boots before the Slack
  // app has been reconfigured for Socket Mode.
  SLACK_APP_TOKEN: z.string().optional().default(""),
  DEV_SIMULATOR: z.string().optional().default("false"),
});

export type Config = {
  slackBotToken: string;
  gitlabWebhookSecret: string;
  gitlabBaseUrl: string;
  databaseUrl: string;
  port: number;
  logLevel: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  workerPollMs: number;
  slackDirectoryRefreshMs: number;
  slackAdminUserIds: string[];
  slackAppToken: string | null;
  devSimulator: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Config {
  const parsed = rawSchema.parse(env);

  return {
    slackBotToken: parsed.SLACK_BOT_TOKEN,
    gitlabWebhookSecret: parsed.GITLAB_WEBHOOK_SECRET,
    gitlabBaseUrl: parsed.GITLAB_BASE_URL,
    databaseUrl: parsed.DATABASE_URL,
    port: Number(parsed.PORT),
    logLevel: parsed.LOG_LEVEL,
    workerPollMs: Number(parsed.WORKER_POLL_MS),
    slackDirectoryRefreshMs: Number(parsed.SLACK_DIRECTORY_REFRESH_MS),
    slackAdminUserIds: parsed.SLACK_ADMIN_USER_IDS.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    slackAppToken: parsed.SLACK_APP_TOKEN || null,
    devSimulator: parseBool(parsed.DEV_SIMULATOR),
  };
}

function parseBool(raw: string): boolean {
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}
