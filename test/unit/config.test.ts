import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

const BASE_ENV = {
  SLACK_BOT_TOKEN: "xoxb-test",
  GITLAB_WEBHOOK_SECRET: "secret",
  GITLAB_BASE_URL: "https://gitlab.example.com",
  DATABASE_URL: "file:./data/test.db",
};

describe("loadConfig", () => {
  it("loads required fields from env", () => {
    const cfg = loadConfig(BASE_ENV);
    expect(cfg.slackBotToken).toBe("xoxb-test");
    expect(cfg.gitlabWebhookSecret).toBe("secret");
    expect(cfg.databaseUrl).toBe("file:./data/test.db");
  });

  it("applies defaults", () => {
    const cfg = loadConfig(BASE_ENV);
    expect(cfg.port).toBe(8080);
    expect(cfg.logLevel).toBe("info");
    expect(cfg.workerPollMs).toBe(500);
    expect(cfg.slackDirectoryRefreshMs).toBe(900_000);
    expect(cfg.devSimulator).toBe(false);
  });

  it("parses SLACK_ADMIN_USER_IDS", () => {
    expect(loadConfig({ ...BASE_ENV, SLACK_ADMIN_USER_IDS: "U1, U2" }).slackAdminUserIds).toEqual([
      "U1",
      "U2",
    ]);
    expect(loadConfig(BASE_ENV).slackAdminUserIds).toEqual([]);
  });

  it("parses DEV_SIMULATOR", () => {
    expect(loadConfig({ ...BASE_ENV, DEV_SIMULATOR: "true" }).devSimulator).toBe(true);
    expect(loadConfig({ ...BASE_ENV, DEV_SIMULATOR: "1" }).devSimulator).toBe(true);
    expect(loadConfig({ ...BASE_ENV, DEV_SIMULATOR: "no" }).devSimulator).toBe(false);
  });

  it("throws on missing required env", () => {
    const { SLACK_BOT_TOKEN: _, ...rest } = BASE_ENV;
    expect(() => loadConfig(rest)).toThrow(/SLACK_BOT_TOKEN/);
  });

  it("ignores the settings that moved to the database", () => {
    // These keys used to be config. Leaving them set must not resurrect them or
    // make loadConfig fail — the panel owns these now.
    const cfg = loadConfig({
      ...BASE_ENV,
      SLACK_DEFAULT_CHANNEL_ID: "C-STALE",
      PROJECT_CHANNEL_MAP: "12=C111",
      ENABLED_PROJECT_IDS: "12,34",
      JIRA_BASE_URL: "https://jira.example.com",
      JIRA_KEY_REGEX: "ZZZ-\\d+",
      SLACK_MENTIONS: "false",
      SLACK_USER_MAP: "a.b=U1",
    });
    expect(cfg).not.toHaveProperty("slackDefaultChannelId");
    expect(cfg).not.toHaveProperty("projectChannelMap");
    expect(cfg).not.toHaveProperty("enabledProjectIds");
    expect(cfg).not.toHaveProperty("jiraBaseUrl");
    expect(cfg).not.toHaveProperty("jiraKeyRegex");
    expect(cfg).not.toHaveProperty("slackMentions");
    expect(cfg).not.toHaveProperty("slackUserMap");
  });

  it("boots without SLACK_DEFAULT_CHANNEL_ID, which is no longer required", () => {
    expect(() => loadConfig(BASE_ENV)).not.toThrow();
  });
});
