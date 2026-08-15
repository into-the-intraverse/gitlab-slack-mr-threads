import type { SettingsAuditEntry } from "../../persistence/settings-audit.js";
import type { ProjectSettings } from "../../settings/projects.js";
import type { Settings } from "../../settings/schema.js";
import { escapeMrkdwn } from "../mrkdwn.js";

export const ACTION = {
  defaultChannel: "settings_default_channel",
  editProject: "settings_edit_project",
  editMessages: "settings_edit_messages",
} as const;

export const BLOCK = {
  defaultChannel: "block_default_channel",
} as const;

export type HomeViewInput = {
  settings: Settings;
  projects: ProjectSettings[];
  audit: SettingsAuditEntry[];
  health: { socketConnected: boolean; pending: number; failed: number; threads: number };
  /** Controls are omitted entirely when false — a hidden button is not security,
   *  but there is no reason to render one that will be refused. */
  canEdit: boolean;
  channelError?: string | undefined;
  nowMs: number;
};

const context = (text: string) => ({
  type: "context",
  elements: [{ type: "mrkdwn", text }],
});

const section = (text: string, accessory?: unknown) => ({
  type: "section",
  text: { type: "mrkdwn", text },
  ...(accessory ? { accessory } : {}),
});

export function renderHomeView(input: HomeViewInput): { type: "home"; blocks: unknown[] } {
  const { settings, health } = input;
  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: "GitLab → Slack" } },
    context(
      [
        health.socketConnected ? "✅ connected" : "⚠️ reconnecting",
        `queue ${health.pending}`,
        `failed ${health.failed}`,
        `${health.threads} threads`,
      ].join("  ·  "),
    ),
  ];

  if (!settings.default_channel_id) {
    blocks.push(
      section("*Not configured*"),
      context("Pick a default channel to start delivering merge request threads."),
    );
    if (input.canEdit) blocks.push(defaultChannelBlock(input));
    else blocks.push(context("Settings are changed by admins."));
    return { type: "home", blocks };
  }

  blocks.push(
    input.canEdit
      ? defaultChannelBlock(input)
      : section(`*Default channel*  <#${settings.default_channel_id}>`),
    context("Projects without a channel of their own post here."),
  );
  if (input.channelError) blocks.push(context(`⚠️ ${escapeMrkdwn(input.channelError)}`));

  blocks.push({ type: "divider" }, section("*Projects*"));

  if (input.projects.length === 0) {
    blocks.push(context("No project has sent an event yet."));
  }

  for (const p of input.projects) {
    const where = p.channel_id ? `<#${p.channel_id}>` : "default channel";
    blocks.push(
      section(
        `*${escapeMrkdwn(p.name)}*  ·  ${where}`,
        input.canEdit
          ? {
              type: "button",
              action_id: ACTION.editProject,
              text: { type: "plain_text", text: "Edit" },
              value: String(p.project_id),
            }
          : undefined,
      ),
      context(
        [p.enabled ? null : "off", `last event ${ago(p.last_seen_at, input.nowMs)}`]
          .filter((s): s is string => s !== null)
          .join("  ·  "),
      ),
    );
  }

  blocks.push(
    { type: "divider" },
    section(
      "*Messages*",
      input.canEdit
        ? {
            type: "button",
            action_id: ACTION.editMessages,
            text: { type: "plain_text", text: "Edit" },
            value: "messages",
          }
        : undefined,
    ),
    context(
      [
        settings.mentions_enabled ? "Mentions on" : "Mentions off",
        settings.jira_base_url ? `Jira ${escapeMrkdwn(settings.jira_base_url)}` : "No Jira link",
        `Ticket key \`${escapeMrkdwn(settings.jira_key_regex)}\``,
      ].join("  ·  "),
    ),
  );

  if (input.audit.length > 0) {
    blocks.push({ type: "divider" });
    for (const e of input.audit) {
      blocks.push(
        context(
          `${e.at}  ·  ${escapeMrkdwn(e.actor_name)}  ·  ${e.scope} ${e.key} → ${escapeMrkdwn(
            e.new_value ?? "null",
          )}`,
        ),
      );
    }
  }

  if (!input.canEdit) blocks.push(context("Settings are changed by admins."));

  return { type: "home", blocks };
}

function defaultChannelBlock(input: HomeViewInput) {
  const id = input.settings.default_channel_id;
  return {
    type: "section",
    block_id: BLOCK.defaultChannel,
    text: { type: "mrkdwn", text: "*Default channel*" },
    accessory: {
      type: "conversations_select",
      action_id: ACTION.defaultChannel,
      placeholder: { type: "plain_text", text: "Pick a channel" },
      filter: { include: ["public", "private"] },
      ...(id ? { initial_conversation: id } : {}),
    },
  };
}

function ago(iso: string, nowMs: number): string {
  const ms = nowMs - Date.parse(iso);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
}
