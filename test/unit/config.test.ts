import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

const BASE_ENV = {
  SLACK_BOT_TOKEN: "xoxb-test",
  SLACK_DEFAULT_CHANNEL_ID: "C123",
  GITLAB_WEBHOOK_SECRET: "secret",
  GITLAB_BASE_URL: "https://gitlab.example.com",
  DATABASE_URL: "file:./data/test.db",
};

describe("loadConfig", () => {
  it("loads required fields from env", () => {
    const cfg = loadConfig(BASE_ENV);
    expect(cfg.slackBotToken).toBe("xoxb-test");
    expect(cfg.slackDefaultChannelId).toBe("C123");
    expect(cfg.gitlabWebhookSecret).toBe("secret");
    expect(cfg.databaseUrl).toBe("file:./data/test.db");
  });

  it("applies defaults", () => {
    const cfg = loadConfig(BASE_ENV);
    expect(cfg.port).toBe(8080);
    expect(cfg.logLevel).toBe("info");
    expect(cfg.workerPollMs).toBe(500);
    expect(cfg.jiraKeyRegex.source).toBe("[A-Z][A-Z0-9]+-\\d+");
    expect(cfg.enabledProjectIds).toEqual([]);
    expect(cfg.projectChannelMap).toEqual({});
  });

  it("parses ENABLED_PROJECT_IDS", () => {
    const cfg = loadConfig({ ...BASE_ENV, ENABLED_PROJECT_IDS: "12,34,56" });
    expect(cfg.enabledProjectIds).toEqual([12, 34, 56]);
  });

  it("parses PROJECT_CHANNEL_MAP", () => {
    const cfg = loadConfig({
      ...BASE_ENV,
      PROJECT_CHANNEL_MAP: "12=C111,34=C222",
    });
    expect(cfg.projectChannelMap).toEqual({ 12: "C111", 34: "C222" });
  });

  it("throws on missing required env", () => {
    const { SLACK_BOT_TOKEN: _, ...rest } = BASE_ENV;
    expect(() => loadConfig(rest)).toThrow(/SLACK_BOT_TOKEN/);
  });
});
