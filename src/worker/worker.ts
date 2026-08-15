import type { KyselyDb } from "../db/index.js";
import type { Logger } from "../logger.js";
import type { SlackClient } from "../slack/client.js";
import {
  claimNextPending,
  countPending,
  markFailed,
  markProcessed,
} from "../persistence/inbox.js";
import {
  getMrThread,
  insertMrThread,
  updateMrThread,
} from "../persistence/mr-threads.js";
import { writeAudit } from "../persistence/audit.js";
import { mergeRequestEventSchema } from "../gitlab/types.js";
import { extractJiraKey } from "../jira/extract.js";
import { deriveStatus } from "../state/derive.js";
import { renderParentBlocks } from "../slack/blocks.js";
import { renderReplyText } from "../slack/reply.js";
import { hashParent } from "../slack/hash.js";
import { getProject, touchProject } from "../settings/projects.js";
import { isProjectEnabled, resolveChannel } from "../settings/routing.js";
import type { SettingsStore } from "../settings/store.js";
import type { SlackDirectory } from "../slack/directory.js";

export type WorkerDeps = {
  db: KyselyDb;
  slack: SlackClient;
  /** Always present; the hot `mentions_enabled` setting decides whether it is consulted. */
  directory: SlackDirectory;
  log: Logger;
  settings: SettingsStore;
};

export type Worker = {
  processOnce(): Promise<boolean>;
  start(pollMs: number): void;
  stop(): Promise<void>;
};

export function makeWorker(deps: WorkerDeps): Worker {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let busy = false;
  let lastUnconfiguredWarnAt = 0;

  async function processOnce(): Promise<boolean> {
    const cfg = await deps.settings.read();
    if (!cfg.default_channel_id) {
      // Nothing is claimed and nothing is marked failed: the rows stay untouched
      // in the inbox and drain by themselves once a channel is picked. Being
      // unconfigured is temporary, so events are held rather than lost.
      const now = Date.now();
      if (now - lastUnconfiguredWarnAt > 60_000) {
        lastUnconfiguredWarnAt = now;
        deps.log.warn(
          { pending: await countPending(deps.db) },
          "worker: no default channel configured; events are held in the inbox",
        );
      }
      return false;
    }

    const row = await claimNextPending(deps.db);
    if (!row) return false;

    const corr = row.webhook_uuid;

    let event;
    try {
      // ParseJSONResultsPlugin may have already deserialised the column into an
      // object; fall back to JSON.parse only when it's still a string.
      const raw =
        typeof row.payload_json === "string"
          ? JSON.parse(row.payload_json)
          : row.payload_json;
      event = mergeRequestEventSchema.parse(raw);
    } catch (err) {
      deps.log.warn(
        { err, corr_id: corr },
        "worker: unparseable payload; marking processed to skip",
      );
      await writeAudit(deps.db, {
        correlation_id: corr,
        project_id: null,
        mr_iid: null,
        action: "unknown",
        slack_action: "skip",
        slack_ts: null,
      });
      await markProcessed(deps.db, corr);
      return true;
    }

    const projectId = event.project.id;
    const mrIid = event.object_attributes.iid;
    const action = event.object_attributes.action;

    // A project earns its row by sending an event; nobody types one in by hand.
    await touchProject(deps.db, {
      projectId,
      ...(event.project.name ? { name: event.project.name } : {}),
      ...(event.project.web_url ? { webUrl: event.project.web_url } : {}),
    });
    const project = await getProject(deps.db, projectId);

    if (!isProjectEnabled(project)) {
      deps.log.debug({ corr_id: corr, projectId }, "worker: project not enabled, skipping");
      await writeAudit(deps.db, {
        correlation_id: corr,
        project_id: projectId,
        mr_iid: mrIid,
        action,
        slack_action: "skip",
        slack_ts: null,
      });
      await markProcessed(deps.db, corr);
      return true;
    }

    try {
      const existing = await getMrThread(deps.db, projectId, mrIid);
      const prev = existing
        ? { status: existing.status, approvalsCount: existing.approvals_count }
        : null;

      const derived = deriveStatus(event, prev);
      const replyText = renderReplyText(event);

      const jiraKey =
        existing?.jira_key ??
        extractJiraKey(
          await deps.settings.jiraKeyRegex(),
          event.object_attributes.title,
          event.object_attributes.source_branch,
          event.object_attributes.description ?? "",
        );

      const approvalsCount = Math.max(0, (existing?.approvals_count ?? 0) + derived.approvalsDelta);

      // `event.user` is whoever triggered this event. The author is only that
      // person on `open`, so afterwards the stored value wins.
      const authorName = existing?.author_name ?? event.user.name;
      const authorUsername =
        existing?.author_username ?? (action === "open" ? event.user.username : null);

      const authorMention =
        cfg.mentions_enabled && authorUsername
          ? deps.directory.mention(authorUsername, authorName)
          : null;
      const reviewerMentions = cfg.mentions_enabled
        ? (event.reviewers ?? []).map((r) => deps.directory.mention(r.username, r.name))
        : [];

      const renderInput = {
        status: derived.status,
        jiraKey,
        jiraUrl: jiraKey && cfg.jira_base_url ? `${cfg.jira_base_url}/browse/${jiraKey}` : null,
        title: event.object_attributes.title,
        mrIid,
        authorName,
        authorMention,
        reviewerMentions,
        sourceBranch: event.object_attributes.source_branch,
        targetBranch: event.object_attributes.target_branch,
        webUrl: event.object_attributes.url,
        approvalsCount,
      };

      const rendered = renderParentBlocks(renderInput);
      const newHash = hashParent(rendered.text, rendered.blocks);

      if (!existing) {
        // New MR → post parent
        if (action !== "open") {
          // Unusual: first event for this MR is not `open` (missed event?).
          // Still create the thread so subsequent events land correctly.
          deps.log.warn(
            { corr_id: corr, action, projectId, mrIid },
            "worker: first event for MR is not 'open'; creating thread anyway",
          );
        }

        const channel = resolveChannel(project, cfg.default_channel_id);
        const { ts } = await deps.slack.postParent({
          channel,
          text: rendered.text,
          blocks: rendered.blocks,
        });
        await insertMrThread(deps.db, {
          project_id: projectId,
          mr_iid: mrIid,
          slack_channel_id: channel,
          slack_thread_ts: ts,
          jira_key: jiraKey,
          title: event.object_attributes.title,
          author_name: authorName,
          author_username: authorUsername,
          source_branch: event.object_attributes.source_branch,
          target_branch: event.object_attributes.target_branch,
          web_url: event.object_attributes.url,
          status: derived.status,
          last_parent_hash: newHash,
        });
        await writeAudit(deps.db, {
          correlation_id: corr,
          project_id: projectId,
          mr_iid: mrIid,
          action,
          slack_action: "post_parent",
          slack_ts: ts,
        });
      } else {
        // Existing thread → update parent if changed, post reply if applicable.
        if (newHash !== existing.last_parent_hash) {
          await deps.slack.updateParent({
            channel: existing.slack_channel_id,
            ts: existing.slack_thread_ts,
            text: rendered.text,
            blocks: rendered.blocks,
          });
          await updateMrThread(deps.db, projectId, mrIid, {
            status: derived.status,
            approvals_count: approvalsCount,
            last_parent_hash: newHash,
          });
          await writeAudit(deps.db, {
            correlation_id: corr,
            project_id: projectId,
            mr_iid: mrIid,
            action,
            slack_action: "update_parent",
            slack_ts: existing.slack_thread_ts,
          });
        } else if (approvalsCount !== existing.approvals_count || derived.status !== existing.status) {
          // Counts changed but blocks unchanged (shouldn't happen — defensive).
          await updateMrThread(deps.db, projectId, mrIid, {
            status: derived.status,
            approvals_count: approvalsCount,
          });
        }

        if (replyText) {
          await deps.slack.postReply({
            channel: existing.slack_channel_id,
            threadTs: existing.slack_thread_ts,
            text: replyText,
          });
          await writeAudit(deps.db, {
            correlation_id: corr,
            project_id: projectId,
            mr_iid: mrIid,
            action,
            slack_action: "post_reply",
            slack_ts: existing.slack_thread_ts,
          });
        } else if (newHash === existing.last_parent_hash) {
          // No-op event (label change, description edit)
          await writeAudit(deps.db, {
            correlation_id: corr,
            project_id: projectId,
            mr_iid: mrIid,
            action,
            slack_action: "skip",
            slack_ts: null,
          });
        }
      }

      await markProcessed(deps.db, corr);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.log.error({ err, corr_id: corr }, "worker: processing failed");
      await markFailed(deps.db, corr, msg);
      await writeAudit(deps.db, {
        correlation_id: corr,
        project_id: projectId,
        mr_iid: mrIid,
        action,
        slack_action: "error",
        slack_ts: null,
      });
      return true;
    }
  }

  async function tick(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      while (running) {
        const didWork = await processOnce();
        if (!didWork) break;
      }
    } catch (err) {
      deps.log.error({ err }, "worker: tick crashed");
    } finally {
      busy = false;
    }
  }

  return {
    processOnce,
    start(pollMs: number) {
      if (running) return;
      running = true;
      timer = setInterval(() => {
        void tick();
      }, pollMs);
    },
    async stop() {
      running = false;
      if (timer) clearInterval(timer);
      timer = null;
      // Wait for in-flight tick to finish
      while (busy) {
        await new Promise((r) => setTimeout(r, 10));
      }
    },
  };
}
