import type { MrStatus } from "../state/derive.js";

const STATUS_EMOJI: Record<MrStatus, string> = {
  open: "🟢",
  draft: "📝",
  approved: "✅",
  merged: "🟣",
  closed: "⚫",
};

const STATUS_LABEL: Record<MrStatus, string> = {
  open: "Open",
  draft: "Draft",
  approved: "Approved",
  merged: "Merged",
  closed: "Closed",
};

export type ParentRenderInput = {
  status: MrStatus;
  jiraKey: string | null;
  title: string;
  mrIid: number;
  authorName: string;
  sourceBranch: string;
  targetBranch: string;
  webUrl: string;
  approvalsCount: number;
};

export type RenderedParent = {
  text: string;
  blocks: unknown[];
};

export function renderParentBlocks(input: ParentRenderInput): RenderedParent {
  const emoji = STATUS_EMOJI[input.status];
  const label = STATUS_LABEL[input.status];
  const jiraPrefix = input.jiraKey ? `[${input.jiraKey}]` : "[NO-JIRA]";

  const titleWithPrefix = input.jiraKey
    ? `[${input.jiraKey}] ${input.title}`
    : input.title;

  const header = `${emoji} ${label} · !${input.mrIid}  ·  ${jiraPrefix}`;

  const text = `${jiraPrefix} ${input.title} — ${label}`;

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: header, emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*<${input.webUrl}|${escapeMrkdwn(titleWithPrefix)}>*`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `${escapeMrkdwn(input.authorName)} • \`${input.sourceBranch}\` → \`${input.targetBranch}\`` +
          (input.approvalsCount > 0 ? `\n👍 ${input.approvalsCount} approvals` : ""),
      },
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `<${input.webUrl}|View MR ↗>` },
      ],
    },
  ];

  return { text, blocks };
}

function escapeMrkdwn(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);
}
