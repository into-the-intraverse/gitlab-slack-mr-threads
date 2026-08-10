import type { MrStatus } from "../state/derive.js";
import { escapeMrkdwn } from "./mrkdwn.js";

// Self-describing pictographs rather than colour-coded circles: a circle only
// carries meaning once you have learnt the colour code, ✅ and 🔀 do not.
// Each glyph is shared with the thread reply that moves the MR into that state
// (see reply.ts), so the channel has one vocabulary instead of two.
export const STATUS_EMOJI: Record<MrStatus, string> = {
  draft: "📝",
  open: "👀",
  approved: "✅",
  merged: "🔀",
  closed: "🚫",
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
  /** Link target for the ticket; null when JIRA_BASE_URL is unset. */
  jiraUrl?: string | null;
  title: string;
  mrIid: number;
  authorName: string;
  sourceBranch: string;
  targetBranch: string;
  webUrl: string;
  approvalsCount: number;
  /** Render-ready mrkdwn for the author (`<@U123>` or an escaped name). */
  authorMention?: string | null;
  /** Render-ready mrkdwn per reviewer, in payload order. */
  reviewerMentions?: string[];
};

export type RenderedParent = {
  text: string;
  blocks: unknown[];
};

const DOT = "  ·  ";

/**
 * Three tiers, because Slack only really gives three: `context` renders small
 * and muted, `section` renders at body size. The title is the single body-size
 * line in the message, so it reads as the headline without needing a `header`
 * block — which cannot hold a link.
 *
 *   context   👀 Open · !3800 · ABC-1234     eyebrow: state and identity
 *   section   *Make the thing faster*            headline: what this MR is
 *   context   Jan · Reviewers: Anna · Piotr     byline: the people
 *             `feature/x` → `master`             and the code, on its own line
 */
export function renderParentBlocks(input: ParentRenderInput): RenderedParent {
  const emoji = STATUS_EMOJI[input.status];
  const label = STATUS_LABEL[input.status];

  // GitLab titles usually start with the key ("[SD-1] Fix thing") and the
  // eyebrow already carries it, so it is stripped from the headline.
  const cleanTitle = stripJiraPrefix(input.title, input.jiraKey);

  const ticket = input.jiraKey
    ? input.jiraUrl
      ? `<${input.jiraUrl}|${input.jiraKey}>`
      : input.jiraKey
    : "no ticket";

  const eyebrow = [`${emoji} ${label}`, `<${input.webUrl}|!${input.mrIid}>`, ticket].join(DOT);

  // Notification and screen-reader fallback — never rendered in-channel.
  const text = `${input.jiraKey ? `[${input.jiraKey}]` : "[NO-JIRA]"} ${cleanTitle} — ${label}`;

  // People on one line, code on the next. Grouping by kind gives the branch pair
  // a line of its own, so a long branch name competes with nothing.
  const people = [
    input.authorMention ?? escapeMrkdwn(input.authorName),
    input.reviewerMentions?.length ? `Reviewers: ${input.reviewerMentions.join(" · ")}` : null,
    input.approvalsCount > 0 ? `👍 ${input.approvalsCount} approved` : null,
  ]
    .filter((s): s is string => s !== null)
    .join(DOT);

  // Monospaced because a branch is an identifier to recognise and copy, not
  // prose to read — the same treatment it gets in GitLab and in a terminal.
  const branches = `\`${escapeMrkdwn(input.sourceBranch)}\` → \`${escapeMrkdwn(input.targetBranch)}\``;

  const blocks: unknown[] = [
    { type: "context", elements: [{ type: "mrkdwn", text: eyebrow }] },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*<${input.webUrl}|${escapeMrkdwn(cleanTitle)}>*` },
    },
    { type: "context", elements: [{ type: "mrkdwn", text: `${people}\n${branches}` }] },
  ];

  return { text, blocks };
}

/**
 * Drops a leading Jira key from an MR title: "[SD-1] Fix", "SD-1: Fix", "SD-1 - Fix".
 * Returns the title untouched if stripping would leave nothing behind.
 */
function stripJiraPrefix(title: string, jiraKey: string | null): string {
  if (!jiraKey) return title.trim();
  const key = jiraKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = title
    .replace(new RegExp(`^\\s*\\[?${key}\\]?\\s*[:\\-–—]?\\s*`, "i"), "")
    .trim();
  return stripped || title.trim();
}
