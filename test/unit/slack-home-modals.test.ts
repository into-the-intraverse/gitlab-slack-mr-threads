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

type Block = {
  type: string;
  block_id?: string;
  optional?: boolean;
  element?: Record<string, unknown>;
};
const inputsOf = (view: unknown) =>
  (view as { blocks: Block[] }).blocks.filter((b) => b.type === "input");

describe("projectModal", () => {
  it("names the modal after the project and carries its id", () => {
    const view = projectModal(project) as { title: { text: string }; private_metadata: string };
    expect(view.title.text).toBe("api-gateway");
    expect(view.private_metadata).toBe("12345");
  });

  it("leaves a name that just fits alone", () => {
    const name = "x".repeat(24);
    const view = projectModal({ ...project, name }) as { title: { text: string } };
    expect(view.title.text).toBe(name);
  });

  // A required Block Kit input refuses an empty submission, so ticking "use the
  // default channel" and leaving the select empty has to stay possible.
  it("keeps every input optional", () => {
    expect(inputsOf(projectModal(project)).map((b) => [b.block_id, b.optional])).toEqual([
      ["block_use_default", true],
      ["block_channel", true],
      ["block_enabled", true],
    ]);
  });

  it("warns that open threads do not move", () => {
    expect(JSON.stringify(projectModal(project))).toContain("stay in their current channel");
  });

  it("offers a way back to the default channel", () => {
    expect(JSON.stringify(projectModal(project))).toContain("use_default");
  });

  it("pre-ticks the boxes that match the saved state", () => {
    const own = JSON.stringify(projectModal(project));
    expect(own).toContain('"initial_conversation":"C-BACKEND"');
    expect(own).toContain('"initial_options"');

    const off = JSON.stringify(projectModal({ ...project, channel_id: null, enabled: false }));
    expect(off).not.toContain("initial_conversation");
    // "Use the default channel" stays ticked; "Receive events" does not.
    expect(off.match(/initial_options/g)).toHaveLength(1);
  });

  it("shortens a project name that would not fit in a modal title", () => {
    const view = projectModal({ ...project, name: "a-really-long-project-name-here" }) as {
      title: { text: string };
    };
    expect(view.title.text).toHaveLength(24);
    expect(view.title.text.endsWith("…")).toBe(true);
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

  it("rejects a submission that lost the project id", () => {
    const r = parseProjectModal({ callback_id: MODAL.project, state: { values: {} } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.block_channel).toMatch(/which project/i);
  });

  it("reads a form Slack sent with blocks missing", () => {
    // Optional inputs are omitted from state.values when they are left empty.
    const r = parseProjectModal({ private_metadata: "12345", state: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.block_channel).toBeTruthy();
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

  it("requires the ticket pattern and nothing else", () => {
    // Everything else must stay clearable: a required field could never be emptied.
    expect(
      inputsOf(messagesModal(SETTINGS_DEFAULTS)).map((b) => [b.block_id, b.optional ?? false]),
    ).toEqual([
      ["block_mentions", true],
      ["block_jira_url", true],
      ["block_jira_regex", false],
      ["block_user_map", true],
    ]);
  });

  it("gives the overrides field room for one line per person", () => {
    const userMap = inputsOf(messagesModal(SETTINGS_DEFAULTS)).find(
      (b) => b.block_id === "block_user_map",
    );
    expect(userMap?.element?.multiline).toBe(true);
  });

  it("leaves the optional fields blank when nothing is saved", () => {
    const text = JSON.stringify(
      messagesModal({ ...SETTINGS_DEFAULTS, mentions_enabled: false, user_map: {} }),
    );
    expect(text).not.toContain("initial_options");
    // Only the required pattern field is pre-filled.
    expect(text.match(/initial_value/g)).toHaveLength(1);
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

  it("trims every trailing slash off the Jira address", () => {
    const r = parseMessagesModal(
      submitted(
        MODAL.messages,
        values({ block_jira_url: { jira_url: { value: "https://jira.example.com///" } } }),
      ),
    );
    expect(r.ok && r.value.jira_base_url).toBe("https://jira.example.com");
  });

  it("accepts a pattern of exactly 200 characters", () => {
    const r = parseMessagesModal(
      submitted(
        MODAL.messages,
        values({ block_jira_regex: { jira_regex: { value: "a".repeat(200) } } }),
      ),
    );
    expect(r.ok).toBe(true);
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

  it("rejects an id with anything before or after it", () => {
    const idIsRefused = (id: string) => {
      const r = parseMessagesModal(
        submitted(MODAL.messages, values({ block_user_map: { user_map: { value: `a.b=${id}` } } })),
      );
      return !r.ok;
    };
    expect(idIsRefused("U123x")).toBe(true);
    expect(idIsRefused("xU123")).toBe(true);
    expect(idIsRefused("U123")).toBe(false);
  });

  it("rejects a line with no equals sign", () => {
    const r = parseMessagesModal(
      submitted(MODAL.messages, values({ block_user_map: { user_map: { value: "nonsense" } } })),
    );
    expect(r.ok).toBe(false);
    // The message has to name the shape, not blame the id it never found.
    if (!r.ok) expect(r.errors.block_user_map).toMatch(/Cannot read/);
  });

  it("rejects a line with no GitLab username", () => {
    const r = parseMessagesModal(
      submitted(MODAL.messages, values({ block_user_map: { user_map: { value: " = U123" } } })),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.block_user_map).toMatch(/^Missing a GitLab username/);
  });

  it("skips blank lines, including ones that only look blank", () => {
    const r = parseMessagesModal(
      submitted(
        MODAL.messages,
        values({ block_user_map: { user_map: { value: "a.b = U123\n   \n\nc.d = W456" } } }),
      ),
    );
    expect(r.ok && r.value.user_map).toEqual({ "a.b": "U123", "c.d": "W456" });
  });

  it("insists on a ticket pattern", () => {
    const r = parseMessagesModal(
      submitted(MODAL.messages, values({ block_jira_regex: { jira_regex: { value: "  " } } })),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.block_jira_regex).toMatch(/required/i);
  });

  it("reports every bad field at once, not just the first", () => {
    const r = parseMessagesModal(
      submitted(
        MODAL.messages,
        values({
          block_jira_url: { jira_url: { value: "jira" } },
          block_jira_regex: { jira_regex: { value: "(" } },
          block_user_map: { user_map: { value: "nonsense" } },
        }),
      ),
    );
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(Object.keys(r.errors).sort()).toEqual([
        "block_jira_regex",
        "block_jira_url",
        "block_user_map",
      ]);
  });

  // Slack leaves optional inputs out of state.values entirely when they are empty.
  it("treats a form with no fields at all as an empty one", () => {
    const r = parseMessagesModal({ callback_id: MODAL.messages });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual({ block_jira_regex: "A pattern is required." });
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
