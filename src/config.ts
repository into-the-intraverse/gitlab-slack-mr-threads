import { z } from "zod";

const rawSchema = z.object({
  SLACK_BOT_TOKEN: z.string().min(1, "SLACK_BOT_TOKEN required"),
  SLACK_DEFAULT_CHANNEL_ID: z.string().min(1, "SLACK_DEFAULT_CHANNEL_ID required"),
  PROJECT_CHANNEL_MAP: z.string().optional().default(""),
  ENABLED_PROJECT_IDS: z.string().optional().default(""),
  GITLAB_WEBHOOK_SECRET: z.string().min(1, "GITLAB_WEBHOOK_SECRET required"),
  GITLAB_BASE_URL: z.string().url("GITLAB_BASE_URL must be a URL"),
  JIRA_KEY_REGEX: z.string().optional().default("[A-Z][A-Z0-9]+-\\d+"),
  // docker-compose passes unset variables through as "", which is not a URL.
  JIRA_BASE_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().url("JIRA_BASE_URL must be a URL").optional(),
  ),
  DATABASE_URL: z.string().min(1, "DATABASE_URL required"),
  PORT: z.string().optional().default("8080"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).optional().default("info"),
  WORKER_POLL_MS: z.string().optional().default("500"),
  DEV_SIMULATOR: z.string().optional().default("false"),
  SLACK_MENTIONS: z.string().optional().default("true"),
  SLACK_USER_MAP: z.string().optional().default(""),
  SLACK_DIRECTORY_REFRESH_MS: z.string().optional().default("900000"),
});

export type Config = {
  slackBotToken: string;
  slackDefaultChannelId: string;
  projectChannelMap: Record<number, string>;
  enabledProjectIds: number[];
  gitlabWebhookSecret: string;
  gitlabBaseUrl: string;
  jiraKeyRegex: RegExp;
  /** Ticket links are rendered only when this is set. */
  jiraBaseUrl: string | null;
  databaseUrl: string;
  port: number;
  logLevel: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  workerPollMs: number;
  devSimulator: boolean;
  slackMentions: boolean;
  slackUserMap: Record<string, string>;
  slackDirectoryRefreshMs: number;
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
    // Case-insensitive: people type `abc-1234` as often as `ABC-1234`.
    // extractJiraKey() normalises whatever matched to upper case.
    jiraKeyRegex: new RegExp(parsed.JIRA_KEY_REGEX, "i"),
    jiraBaseUrl: parsed.JIRA_BASE_URL?.replace(/\/+$/, "") ?? null,
    databaseUrl: parsed.DATABASE_URL,
    port: Number(parsed.PORT),
    logLevel: parsed.LOG_LEVEL,
    workerPollMs: Number(parsed.WORKER_POLL_MS),
    devSimulator: parseBool(parsed.DEV_SIMULATOR),
    slackMentions: parseBool(parsed.SLACK_MENTIONS),
    slackUserMap: parseUserMap(parsed.SLACK_USER_MAP),
    slackDirectoryRefreshMs: Number(parsed.SLACK_DIRECTORY_REFRESH_MS),
  };
}

function parseUserMap(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [k, v] = pair.split("=");
    if (!k || !v) continue;
    out[k.trim()] = v.trim();
  }
  return out;
}

function parseBool(raw: string): boolean {
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
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
