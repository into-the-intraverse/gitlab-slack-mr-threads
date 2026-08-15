import { describe, expect, it } from "vitest";
import type { ProjectSettings } from "../../src/settings/projects.js";
import { SETTINGS_DEFAULTS } from "../../src/settings/schema.js";
import { ACTION, type HomeViewInput, renderHomeView } from "../../src/slack/home/view.js";

const project: ProjectSettings = {
  project_id: 12345,
  name: "api-gateway",
  web_url: "https://gitlab.example.com/team/api-gateway",
  channel_id: "C-BACKEND",
  enabled: true,
  last_seen_at: "2026-08-14T09:57:00.000Z",
};

const base: HomeViewInput = {
  settings: { ...SETTINGS_DEFAULTS, default_channel_id: "C-DEFAULT" },
  projects: [project],
  audit: [],
  health: { socketConnected: true, pending: 0, failed: 0, threads: 12 },
  canEdit: true,
  nowMs: Date.parse("2026-08-14T10:00:00.000Z"),
};

const json = (input: HomeViewInput) => JSON.stringify(renderHomeView(input));

describe("renderHomeView", () => {
  it("is a home view", () => {
    expect(renderHomeView(base).type).toBe("home");
  });

  it("shows health in the eyebrow", () => {
    const text = json(base);
    expect(text).toContain("queue 0");
    expect(text).toContain("failed 0");
    expect(text).toContain("12 threads");
  });

  it("prompts for a channel and hides everything else when unconfigured", () => {
    const text = json({
      ...base,
      settings: { ...SETTINGS_DEFAULTS, default_channel_id: null },
    });
    expect(text).toContain("Not configured");
    expect(text).not.toContain("api-gateway");
  });

  it("lists projects with their channel", () => {
    const text = json(base);
    expect(text).toContain("api-gateway");
    expect(text).toContain("C-BACKEND");
  });

  it("says which projects use the default channel", () => {
    const text = json({
      ...base,
      projects: [{ ...project, channel_id: null }],
    });
    expect(text).toContain("default channel");
  });

  it("marks a switched-off project", () => {
    const text = json({
      ...base,
      projects: [{ ...project, enabled: false }],
    });
    expect(text).toContain("off");
  });

  it("gives an admin a control per project and one for the default channel", () => {
    const text = json(base);
    expect(text).toContain(ACTION.defaultChannel);
    expect(text).toContain(ACTION.editProject);
    expect(text).toContain(ACTION.editMessages);
  });

  it("gives a non-admin no controls at all", () => {
    const view = renderHomeView({ ...base, canEdit: false });
    const text = JSON.stringify(view);
    expect(text).not.toContain(ACTION.defaultChannel);
    expect(text).not.toContain(ACTION.editProject);
    expect(text).not.toContain(ACTION.editMessages);
    expect(text).not.toContain("conversations_select");
    expect(text).toContain("Settings are changed by admins");
  });

  it("carries the project id on the edit button so the handler knows which one", () => {
    const text = json(base);
    expect(text).toContain('"value":"12345"');
  });

  it("shows a channel error under the select when one is passed", () => {
    const text = json({ ...base, channelError: "The bot is not in that channel" });
    expect(text).toContain("The bot is not in that channel");
  });

  it("shows a channel error while still unconfigured", () => {
    const text = json({
      ...base,
      settings: { ...SETTINGS_DEFAULTS, default_channel_id: null },
      channelError: "The bot is not in that channel",
    });
    expect(text).toContain("The bot is not in that channel");
  });

  it("renders recent changes", () => {
    const text = json({
      ...base,
      audit: [
        {
          at: "2026-08-13T18:20:00.000Z",
          actor_user_id: "U1",
          actor_name: "Alex",
          scope: "project:12345",
          key: "channel_id",
          old_value: "null",
          new_value: '"C-BACKEND"',
        },
      ],
    });
    expect(text).toContain("Alex");
    expect(text).toContain("channel_id");
  });

  it("is deterministic", () => {
    expect(json(base)).toBe(json(base));
  });
});
