import type { Generated } from "kysely";

// All timestamps are ISO-8601 strings in the DB. We don't round-trip through Date.
export type DB = {
  inbox: InboxTable;
  mr_threads: MrThreadsTable;
  audit_log: AuditLogTable;
  settings: SettingsTable;
  project_settings: ProjectSettingsTable;
  settings_audit: SettingsAuditTable;
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
  author_username: string | null;
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

// Values are JSON-encoded so a string, a boolean and an object share one column.
// A missing row means "default", so a fresh install needs no seed.
export type SettingsTable = {
  key: string;
  value: string;
  updated_at: string;
};

export type ProjectSettingsTable = {
  project_id: number;
  name: string;
  web_url: string;
  /** NULL means "use the default channel". */
  channel_id: string | null;
  enabled: Generated<number>;
  last_seen_at: string;
};

// `audit_log` is shaped for MR events and has no actor column, so settings
// changes get their own table rather than a null-heavy row.
export type SettingsAuditTable = {
  id: Generated<number>;
  at: string;
  actor_user_id: string;
  actor_name: string;
  /** `global` or `project:<id>`. */
  scope: string;
  key: string;
  old_value: string | null;
  new_value: string | null;
};
