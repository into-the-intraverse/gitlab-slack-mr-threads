import type { Migration } from "kysely";
import * as m001 from "./001_inbox.js";
import * as m002 from "./002_mr_threads.js";
import * as m003 from "./003_audit_log.js";
import * as m004 from "./004_mr_thread_author_username.js";
import * as m005 from "./005_settings.js";
import * as m006 from "./006_settings_audit.js";
import * as m007 from "./007_project_settings.js";

/**
 * Every migration, imported by name.
 *
 * Deliberately a hand-written list rather than a directory scan: a scan means
 * `readdir` plus dynamic `import()`, which behaves differently under vitest,
 * under `tsx`, and under plain node — the last of which once shipped a build
 * that could not boot at all. A forgotten line here fails loudly and at once,
 * because the table the new migration creates will not exist.
 *
 * Kysely sorts by key, so the numeric prefixes are what fixes the order.
 */
export const MIGRATIONS: Record<string, Migration> = {
  "001_inbox": m001,
  "002_mr_threads": m002,
  "003_audit_log": m003,
  "004_mr_thread_author_username": m004,
  "005_settings": m005,
  "006_settings_audit": m006,
  "007_project_settings": m007,
};
