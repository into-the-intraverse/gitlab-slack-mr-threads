import { describe, expect, it } from "vitest";
import type { ProjectSettings } from "../../src/settings/projects.js";
import { SETTINGS_DEFAULTS } from "../../src/settings/schema.js";
import {
  MODAL,
  formatUserMap,
  messagesModal,
  parseMessagesModal,
  parseProjectModal,
  projectModal,
} from "../../src/slack/home/modals.js";

const project: ProjectSettings = {
  project_id: 12345,
  name: "api-gateway",
  web_url: "https://gitlab.example.com/team/api-gateway",
  channel_id: "C-BACKEND",
  enabled: true,
  last_seen_at: "2026-08-14T09:57:00.000Z",
};

// Shape of a submitted view: state.values[block_id][action_id].
const submitted = (callbackId: string, values: unknown, metadata = "") => ({
  callback_id: callbackId,
  private_metadata: metadata,
  state: { values },
});

describe("projectModal", () => {
  it("names the modal after the project and carries its id", () => {
    const view = projectModal(project) as { title: { text: string }; private_metadata: string };
    expect(view.title.text).toContain("api-gateway");
    expect(view.private_metadata).toBe("12345");
  });

  it("warns that open threads do not move", () => {
    expect(JSON.stringify(projectModal(project))).toContain("stay in their current channel");
  });

  it("offers a way back to the default channel", () => {
    expect(JSON.stringify(projectModal(project))).toContain("use_default");
  });
});

describe("parseProjectModal", () => {
  it("reads an explicit channel and the on switch", () => {
    const r = parseProjectModal(
      submitted(
        MODAL.project,
        {
          block_use_default: { use_default: { selected_options: [] } },
          block_channel: { channel: { selected_conversation: "C-NEW" } },
          block_enabled: { enabled: { selected_options: [{ value: "on" }] } },
        },
        "12345",
      ),
    );
    expect(r).toEqual({
      ok: true,
      value: { projectId: 12345, channelId: "C-NEW", enabled: true },
    });
  });

  it("returns a null channel when 'use the default' is ticked, whatever the select says", () => {
    const r = parseProjectModal(
      submitted(
        MODAL.project,
        {
          block_use_default: { use_default: { selected_options: [{ value: "yes" }] } },
          block_channel: { channel: { selected_conversation: "C-NEW" } },
          block_enabled: { enabled: { selected_options: [{ value: "on" }] } },
        },
        "12345",
      ),
    );
    expect(r).toEqual({ ok: true, value: { projectId: 12345, channelId: null, enabled: true } });
  });

  it("rejects a submission with neither a channel nor the default ticked", () => {
    const r = parseProjectModal(
      submitted(
        MODAL.project,
        {
          block_use_default: { use_default: { selected_options: [] } },
          block_channel: { channel: { selected_conversation: null } },
          block_enabled: { enabled: { selected_options: [] } },
        },
        "12345",
      ),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.block_channel).toMatch(/channel/i);
  });
});

describe("messagesModal", () => {
  it("opens pre-filled with what is currently saved", () => {
    const text = JSON.stringify(
      messagesModal({
        ...SETTINGS_DEFAULTS,
        jira_base_url: "https://jira.example.com",
        user_map: { "a.b": "U123" },
      }),
    );
    expect(text).toContain("https://jira.example.com");
    expect(text).toContain("a.b = U123");
    expect(text).toContain(JSON.stringify(SETTINGS_DEFAULTS.jira_key_regex).slice(1, -1));
  });
});

describe("parseMessagesModal", () => {
  const values = (over: Record<string, unknown> = {}) => ({
    block_mentions: { mentions: { selected_options: [{ value: "on" }] } },
    block_jira_url: { jira_url: { value: "https://jira.example.com" } },
    block_jira_regex: { jira_regex: { value: "(ABC|SD)-\\d+" } },
    block_user_map: { user_map: { value: "" } },
    ...over,
  });

  it("reads a full form", () => {
    const r = parseMessagesModal(submitted(MODAL.messages, values()));
    expect(r).toEqual({
      ok: true,
      value: {
        mentions_enabled: true,
        jira_base_url: "https://jira.example.com",
        jira_key_regex: "(ABC|SD)-\\d+",
        user_map: {},
      },
    });
  });

  it("treats an empty Jira URL as unset", () => {
    const r = parseMessagesModal(
      submitted(MODAL.messages, values({ block_jira_url: { jira_url: { value: "" } } })),
    );
    expect(r.ok && r.value.jira_base_url).toBeNull();
  });

  it("rejects a Jira URL that is not a URL", () => {
    const r = parseMessagesModal(
      submitted(MODAL.messages, values({ block_jira_url: { jira_url: { value: "jira" } } })),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.block_jira_url).toBeTruthy();
  });

  it("rejects a regex that does not compile", () => {
    const r = parseMessagesModal(
      submitted(MODAL.messages, values({ block_jira_regex: { jira_regex: { value: "(" } } })),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.block_jira_regex).toMatch(/compile/i);
  });

  it("rejects a regex longer than 200 characters", () => {
    const r = parseMessagesModal(
      submitted(
        MODAL.messages,
        values({ block_jira_regex: { jira_regex: { value: "a".repeat(201) } } }),
      ),
    );
    expect(r.ok).toBe(false);
  });

  it("parses user overrides line by line", () => {
    const r = parseMessagesModal(
      submitted(
        MODAL.messages,
        values({ block_user_map: { user_map: { value: "a.b = U123\n c.d=W456 \n" } } }),
      ),
    );
    expect(r.ok && r.value.user_map).toEqual({ "a.b": "U123", "c.d": "W456" });
  });

  it("rejects a Slack id that is not a user id", () => {
    const r = parseMessagesModal(
      submitted(MODAL.messages, values({ block_user_map: { user_map: { value: "a.b=C123" } } })),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.block_user_map).toContain("C123");
  });

  it("rejects a line with no equals sign", () => {
    const r = parseMessagesModal(
      submitted(MODAL.messages, values({ block_user_map: { user_map: { value: "nonsense" } } })),
    );
    expect(r.ok).toBe(false);
  });
});

describe("formatUserMap", () => {
  it("round-trips through the modal", () => {
    const text = formatUserMap({ "a.b": "U123" });
    expect(text).toBe("a.b = U123");
    const r = parseMessagesModal(
      submitted(MODAL.messages, {
        block_mentions: { mentions: { selected_options: [] } },
        block_jira_url: { jira_url: { value: "" } },
        block_jira_regex: { jira_regex: { value: SETTINGS_DEFAULTS.jira_key_regex } },
        block_user_map: { user_map: { value: text } },
      }),
    );
    expect(r.ok && r.value.user_map).toEqual({ "a.b": "U123" });
  });
});
