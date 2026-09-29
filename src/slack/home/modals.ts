import type { ProjectSettings } from "../../settings/projects.js";
import type { Settings } from "../../settings/schema.js";

export const MODAL = {
  project: "settings_project",
  messages: "settings_messages",
} as const;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

type ViewState = { state?: { values?: Record<string, Record<string, unknown>> } };

const field = (view: unknown, block: string, action: string): Record<string, unknown> => {
  const values = (view as ViewState).state?.values ?? {};
  return (values[block]?.[action] as Record<string, unknown>) ?? {};
};

const checked = (view: unknown, block: string, action: string): boolean =>
  ((field(view, block, action).selected_options as unknown[] | undefined) ?? []).length > 0;

const text = (view: unknown, block: string, action: string): string =>
  String(field(view, block, action).value ?? "").trim();

// ---------- project ----------

export function projectModal(p: ProjectSettings): unknown {
  const useDefault = {
    text: { type: "plain_text", text: "Use the default channel" },
    value: "yes",
  };
  const receive = { text: { type: "plain_text", text: "Receive events" }, value: "on" };
  return {
    type: "modal",
    callback_id: MODAL.project,
    private_metadata: String(p.project_id),
    title: { type: "plain_text", text: truncate(p.name, 24) },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "block_use_default",
        optional: true,
        label: { type: "plain_text", text: "Channel" },
        element: {
          type: "checkboxes",
          action_id: "use_default",
          options: [useDefault],
          ...(p.channel_id ? {} : { initial_options: [useDefault] }),
        },
      },
      {
        type: "input",
        block_id: "block_channel",
        optional: true,
        label: { type: "plain_text", text: "Or a channel of its own" },
        element: {
          type: "conversations_select",
          action_id: "channel",
          filter: { include: ["public", "private"] },
          ...(p.channel_id ? { initial_conversation: p.channel_id } : {}),
        },
      },
      {
        type: "input",
        block_id: "block_enabled",
        optional: true,
        label: { type: "plain_text", text: "Events" },
        element: {
          type: "checkboxes",
          action_id: "enabled",
          options: [receive],
          ...(p.enabled ? { initial_options: [receive] } : {}),
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Threads that are already open stay in their current channel.",
          },
        ],
      },
    ],
  };
}

export function parseProjectModal(
  view: unknown,
): ParseResult<{ projectId: number; channelId: string | null; enabled: boolean }> {
  const projectId = Number.parseInt(
    String((view as { private_metadata?: string }).private_metadata ?? ""),
    10,
  );
  if (!Number.isFinite(projectId)) {
    return { ok: false, errors: { block_channel: "Lost track of which project this is." } };
  }

  const useDefault = checked(view, "block_use_default", "use_default");
  const selected = field(view, "block_channel", "channel").selected_conversation;
  const channelId = useDefault ? null : ((selected as string | null | undefined) ?? null);

  if (!useDefault && !channelId) {
    return {
      ok: false,
      errors: { block_channel: "Pick a channel, or tick “Use the default channel”." },
    };
  }

  return {
    ok: true,
    value: { projectId, channelId, enabled: checked(view, "block_enabled", "enabled") },
  };
}

// ---------- messages ----------

export function messagesModal(s: Settings): unknown {
  const mentions = {
    text: { type: "plain_text", text: "Mention author and reviewers" },
    value: "on",
  };
  return {
    type: "modal",
    callback_id: MODAL.messages,
    title: { type: "plain_text", text: "Messages" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "block_mentions",
        optional: true,
        label: { type: "plain_text", text: "Mentions" },
        element: {
          type: "checkboxes",
          action_id: "mentions",
          options: [mentions],
          ...(s.mentions_enabled ? { initial_options: [mentions] } : {}),
        },
      },
      {
        type: "input",
        block_id: "block_jira_url",
        optional: true,
        label: { type: "plain_text", text: "Jira address" },
        hint: { type: "plain_text", text: "Leave empty to show ticket keys without a link." },
        element: {
          type: "plain_text_input",
          action_id: "jira_url",
          ...(s.jira_base_url ? { initial_value: s.jira_base_url } : {}),
        },
      },
      {
        type: "input",
        block_id: "block_jira_regex",
        label: { type: "plain_text", text: "Ticket key pattern" },
        element: {
          type: "plain_text_input",
          action_id: "jira_regex",
          initial_value: s.jira_key_regex,
        },
      },
      {
        type: "input",
        block_id: "block_user_map",
        optional: true,
        label: { type: "plain_text", text: "User overrides" },
        hint: {
          type: "plain_text",
          text: "One per line: gitlab.username = U012ABCDEF. For people whose names differ.",
        },
        element: {
          type: "plain_text_input",
          action_id: "user_map",
          multiline: true,
          ...(Object.keys(s.user_map).length > 0
            ? { initial_value: formatUserMap(s.user_map) }
            : {}),
        },
      },
    ],
  };
}

export function parseMessagesModal(
  view: unknown,
): ParseResult<
  Pick<Settings, "mentions_enabled" | "jira_base_url" | "jira_key_regex" | "user_map">
> {
  const errors: Record<string, string> = {};

  const jiraUrlRaw = text(view, "block_jira_url", "jira_url");
  let jiraBaseUrl: string | null = null;
  if (jiraUrlRaw) {
    try {
      new URL(jiraUrlRaw);
      jiraBaseUrl = jiraUrlRaw.replace(/\/+$/, "");
    } catch {
      errors.block_jira_url = "That is not a URL. Example: https://jira.example.com";
    }
  }

  const regex = text(view, "block_jira_regex", "jira_regex");
  if (!regex) {
    errors.block_jira_regex = "A pattern is required.";
  } else if (regex.length > 200) {
    errors.block_jira_regex = "Keep the pattern under 200 characters.";
  } else {
    try {
      new RegExp(regex, "i");
    } catch {
      errors.block_jira_regex = "That pattern does not compile.";
    }
  }

  let userMap: Record<string, string> = {};
  const mapResult = parseUserMapText(text(view, "block_user_map", "user_map"));
  if (mapResult.ok) userMap = mapResult.value;
  else errors.block_user_map = mapResult.error;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      mentions_enabled: checked(view, "block_mentions", "mentions"),
      jira_base_url: jiraBaseUrl,
      jira_key_regex: regex,
      user_map: userMap,
    },
  };
}

export function formatUserMap(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([k, v]) => `${k} = ${v}`)
    .join("\n");
}

function parseUserMapText(
  raw: string,
): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n").map((l) => l.trim())) {
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq < 0)
      return { ok: false, error: `Cannot read “${line}”. Use gitlab.username = U012ABC.` };
    const key = line.slice(0, eq).trim();
    const id = line.slice(eq + 1).trim();
    if (!key) return { ok: false, error: `Missing a GitLab username in “${line}”.` };
    if (!/^[UW][A-Z0-9]+$/.test(id)) {
      return { ok: false, error: `${id} is not a Slack user id. They start with U or W.` };
    }
    out[key] = id;
  }
  return { ok: true, value: out };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
