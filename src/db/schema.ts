import type { Generated } from "kysely";

// All timestamps are ISO-8601 strings in the DB. We don't round-trip through Date.
export type DB = {
  inbox: InboxTable;
  mr_threads: MrThreadsTable;
  audit_log: AuditLogTable;
};

export type InboxTable = {
  webhook_uuid: string;
  event_uuid: string | null;
  received_at: string;
  processed_at: string | null;
  next_attempt_at: string | null;
  payload_json: string;
  error: string | null;
  attempts: Generated<number>;
};

export type MrThreadsTable = {
  id: Generated<number>;
  project_id: number;
  mr_iid: number;
  slack_channel_id: string;
  slack_thread_ts: string;
  jira_key: string | null;
  title: string;
  author_name: string;
  source_branch: string;
  target_branch: string;
  web_url: string;
  status: "open" | "draft" | "approved" | "merged" | "closed";
  approvals_count: Generated<number>;
  last_parent_hash: string;
  created_at: string;
  updated_at: string;
};

export type AuditLogTable = {
  id: Generated<number>;
  correlation_id: string;
  project_id: number | null;
  mr_iid: number | null;
  action: string;
  slack_action: string;
  slack_ts: string | null;
  at: string;
};
