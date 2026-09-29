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

  it("does not tell an admin that settings are changed by admins", () => {
    expect(json(base)).not.toContain("Settings are changed by admins");
  });

  it("hides the channel picker from a non-admin who arrives before setup", () => {
    const text = json({
      ...base,
      settings: { ...SETTINGS_DEFAULTS, default_channel_id: null },
      canEdit: false,
    });
    expect(text).toContain("Not configured");
    expect(text).not.toContain("conversations_select");
    expect(text).toContain("Settings are changed by admins");
  });

  it("does not claim the list is empty when it is not", () => {
    expect(json(base)).not.toContain("No project has sent an event yet");
  });

  it("puts no separator in front of a project that is switched on", () => {
    const blocks = renderHomeView(base).blocks as Array<{
      type: string;
      elements?: Array<{ text: string }>;
    }>;
    const line = blocks.find((b) => b.elements?.[0]?.text.startsWith("last event"));
    // A dropped `null` would show up as a stray "  ·  " before the timestamp.
    expect(line?.elements?.[0]?.text).toBe("last event 3 minutes ago");
  });

  it("adds a divider before the history only when there is history", () => {
    const dividers = (input: HomeViewInput) =>
      (renderHomeView(input).blocks as Array<{ type: string }>).filter((b) => b.type === "divider")
        .length;

    expect(dividers(base)).toBe(2);
    expect(
      dividers({
        ...base,
        audit: [
          {
            at: "2026-08-13T18:20:00.000Z",
            actor_user_id: "U1",
            actor_name: "Alex",
            scope: "global",
            key: "mentions_enabled",
            old_value: "true",
            new_value: "false",
          },
        ],
      }),
    ).toBe(3);
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

  it("says so when the Socket Mode connection has dropped", () => {
    const text = json({ ...base, health: { ...base.health, socketConnected: false } });
    expect(text).toContain("reconnecting");
    expect(text).not.toContain("✅ connected");
  });

  it("summarises the message settings", () => {
    expect(json(base)).toContain("Mentions on");
    expect(json(base)).toContain("No Jira link");

    const text = json({
      ...base,
      settings: {
        ...base.settings,
        mentions_enabled: false,
        jira_base_url: "https://jira.example.com",
      },
    });
    expect(text).toContain("Mentions off");
    expect(text).toContain("Jira https://jira.example.com");
  });

  it("prints a cleared setting as null in the history", () => {
    const text = json({
      ...base,
      audit: [
        {
          at: "2026-08-13T18:20:00.000Z",
          actor_user_id: "U1",
          actor_name: "Alex",
          scope: "global",
          key: "jira_base_url",
          old_value: '"https://jira.example.com"',
          new_value: null,
        },
      ],
    });
    expect(text).toContain("jira_base_url → null");
  });

  it("says when nothing has ever been seen", () => {
    expect(json({ ...base, projects: [] })).toContain("No project has sent an event yet");
  });
});

describe("how long ago the last event was", () => {
  const withLastSeen = (lastSeenAt: string) =>
    json({ ...base, projects: [{ ...project, last_seen_at: lastSeenAt }] });

  it.each([
    ["2026-08-14T09:59:40.000Z", "just now"],
    ["2026-08-14T09:57:00.000Z", "3 minutes ago"],
    ["2026-08-14T05:00:00.000Z", "5 hours ago"],
    ["2026-08-11T10:00:00.000Z", "3 days ago"],
  ])("renders %s as %s", (lastSeenAt, expected) => {
    expect(withLastSeen(lastSeenAt)).toContain(expected);
  });

  // Each unit hands over exactly at its own boundary, never one step late.
  it.each([
    ["one minute", "2026-08-14T09:59:00.000Z", "1 minutes ago"],
    ["one hour", "2026-08-14T09:00:00.000Z", "1 hours ago"],
    ["one day", "2026-08-13T10:00:00.000Z", "1 days ago"],
  ])("switches unit exactly at %s", (_name, lastSeenAt, expected) => {
    expect(withLastSeen(lastSeenAt)).toContain(expected);
  });
});
