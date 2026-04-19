import { z } from "zod";

const rawSchema = z.object({
  SLACK_BOT_TOKEN: z.string().min(1, "SLACK_BOT_TOKEN required"),
  SLACK_DEFAULT_CHANNEL_ID: z.string().min(1, "SLACK_DEFAULT_CHANNEL_ID required"),
  PROJECT_CHANNEL_MAP: z.string().optional().default(""),
  ENABLED_PROJECT_IDS: z.string().optional().default(""),
  GITLAB_WEBHOOK_SECRET: z.string().min(1, "GITLAB_WEBHOOK_SECRET required"),
  GITLAB_BASE_URL: z.string().url("GITLAB_BASE_URL must be a URL"),
  JIRA_KEY_REGEX: z.string().optional().default("[A-Z][A-Z0-9]+-\\d+"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL required"),
  PORT: z.string().optional().default("8080"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).optional().default("info"),
  WORKER_POLL_MS: z.string().optional().default("500"),
});

export type Config = {
  slackBotToken: string;
  slackDefaultChannelId: string;
  projectChannelMap: Record<number, string>;
  enabledProjectIds: number[];
  gitlabWebhookSecret: string;
  gitlabBaseUrl: string;
  jiraKeyRegex: RegExp;
  databaseUrl: string;
  port: number;
  logLevel: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  workerPollMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Config {
  const parsed = rawSchema.parse(env);

  return {
    slackBotToken: parsed.SLACK_BOT_TOKEN,
    slackDefaultChannelId: parsed.SLACK_DEFAULT_CHANNEL_ID,
    projectChannelMap: parseChannelMap(parsed.PROJECT_CHANNEL_MAP),
    enabledProjectIds: parseIdList(parsed.ENABLED_PROJECT_IDS),
    gitlabWebhookSecret: parsed.GITLAB_WEBHOOK_SECRET,
    gitlabBaseUrl: parsed.GITLAB_BASE_URL,
    jiraKeyRegex: new RegExp(parsed.JIRA_KEY_REGEX),
    databaseUrl: parsed.DATABASE_URL,
    port: Number(parsed.PORT),
    logLevel: parsed.LOG_LEVEL,
    workerPollMs: Number(parsed.WORKER_POLL_MS),
  };
}

function parseIdList(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n));
}

function parseChannelMap(raw: string): Record<number, string> {
  const out: Record<number, string> = {};
  for (const pair of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [k, v] = pair.split("=");
    if (!k || !v) continue;
    const id = Number.parseInt(k, 10);
    if (Number.isFinite(id)) out[id] = v;
  }
  return out;
}
