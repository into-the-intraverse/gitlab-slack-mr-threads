import type { MergeRequestEvent } from "../gitlab/types.js";

export function renderReplyText(event: MergeRequestEvent): string | null {
  const { action, target_branch } = event.object_attributes;
  const userName = event.user.name;

  switch (action) {
    case "open":
      return null;

    case "update": {
      const c = event.changes?.draft?.current;
      if (c === true) return "📝 Marked as draft";
      if (c === false) return "🟢 Ready for review";
      return null;
    }

    case "approval":
      return `👍 Approved by ${userName}`;

    case "unapproval":
      return `↩️ Approval revoked by ${userName}`;

    case "approved":
      return "✅ All required approvals received";

    case "unapproved":
      return null;

    case "merge":
      return `🟣 Merged into \`${target_branch}\``;

    case "close":
      return "⚫ Closed without merge";

    case "reopen":
      return null;

    default: {
      const _exhaustive: never = action;
      return null;
    }
  }
}
