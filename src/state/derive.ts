import type { MergeRequestEvent } from "../gitlab/types.js";

export type MrStatus = "open" | "draft" | "approved" | "merged" | "closed";

export type Prev = {
  status: MrStatus;
  approvalsCount: number;
};

export type Derived = {
  status: MrStatus;
  approvalsDelta: number;
};

export function deriveStatus(event: MergeRequestEvent, prev: Prev | null): Derived {
  const { action, draft } = event.object_attributes;

  switch (action) {
    case "open":
      return { status: draft ? "draft" : "open", approvalsDelta: 0 };

    case "merge":
      return { status: "merged", approvalsDelta: 0 };

    case "close":
      return { status: "closed", approvalsDelta: 0 };

    case "approval":
      return { status: prev?.status ?? "open", approvalsDelta: +1 };

    case "unapproval": {
      const next = prev ?? { status: "open" as MrStatus, approvalsCount: 0 };
      const nextCount = next.approvalsCount + -1;
      const status = nextCount <= 0 && next.status === "approved" ? ("open" as MrStatus) : next.status;
      return { status, approvalsDelta: -1 };
    }

    case "approved":
      return { status: "approved", approvalsDelta: 0 };

    case "unapproved":
      return { status: "open", approvalsDelta: 0 };

    case "update": {
      const draftChange = event.changes?.draft?.current;
      if (draftChange === true) return { status: "draft", approvalsDelta: 0 };
      if (draftChange === false) return { status: "open", approvalsDelta: 0 };
      return { status: prev?.status ?? "open", approvalsDelta: 0 };
    }

    case "reopen":
      // v1: reopen is explicitly out of scope; preserve prev or default to open.
      return { status: prev?.status ?? "open", approvalsDelta: 0 };

    default: {
      const _exhaustive: never = action;
      throw new Error(`Unhandled action: ${_exhaustive}`);
    }
  }
}
