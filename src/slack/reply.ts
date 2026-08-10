import type { MergeRequestEvent } from "../gitlab/types.js";

/**
 * Thread replies describe what just happened. When an event moves the MR into a
 * new state, the reply carries that state's glyph from STATUS_EMOJI — reading
 * "🔀 Merged into `master`" and then seeing 🔀 in the parent is one fact, not
 * two. Events that change no state (per-user approval, thread resolution) keep
 * glyphs of their own.
 */
export function renderReplyText(event: MergeRequestEvent): string | null {
  const { action, target_branch } = event.object_attributes;
  const userName = event.user.name;

  switch (action) {
    case "open":
      return null;

    case "update": {
      // Draft first: it moves the MR's status, thread resolution does not.
      const draft = event.changes?.draft?.current;
      if (draft === true) return "📝 Marked as draft";
      if (draft === false) return "👀 Ready for review";

      // Only the "everything resolved" edge is reported. GitLab does not list
      // opening a thread as a webhook trigger, so the false edge is unreliable.
      if (event.changes?.blocking_discussions_resolved?.current === true) {
        return "🧵 All threads resolved";
      }
      return null;
    }

    case "approval":
      return `👍 Approved by ${userName}`;

    case "unapproval":
      return `↩️ Approval revoked by ${userName}`;

    case "approved":
      return "✅ All required approvals received";

    case "unapproved":
      return "⚠️ Approval quorum lost — needs review again";

    case "merge":
      return `🔀 Merged into \`${target_branch}\``;

    case "close":
      return "🚫 Closed without merge";

    case "reopen":
      return null;

    default: {
      const _exhaustive: never = action;
      return null;
    }
  }
}
