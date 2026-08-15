import type { Logger } from "../logger.js";
import type { SlackClient } from "./client.js";
import { escapeMrkdwn } from "./mrkdwn.js";

export type SlackDirectory = {
  /**
   * Render-ready mrkdwn for a GitLab user: `<@U123>` when they map to a Slack
   * account, otherwise their plain display name (visible, but no notification).
   */
  mention(gitlabUsername: string, displayName: string): string;
  /** Applied immediately; `user_map` is editable from the panel. */
  setOverrides(next: Record<string, string>): void;
  refresh(): Promise<void>;
  start(refreshMs: number): void;
  stop(): void;
};

export type SlackDirectoryDeps = {
  slack: SlackClient;
  log: Logger;
  /** `gitlab.username -> U123` overrides for members whose names do not line up. */
  overrides: Record<string, string>;
};

export function makeSlackDirectory(deps: SlackDirectoryDeps): SlackDirectory {
  // Lower-cased Slack handle *and* display name both point at the same id, so a
  // GitLab username matches whichever of the two the member actually set.
  let index = new Map<string, string>();
  let timer: NodeJS.Timeout | null = null;
  const warned = new Set<string>();

  let overrides = new Map(Object.entries(deps.overrides).map(([k, v]) => [k.toLowerCase(), v]));

  async function refresh(): Promise<void> {
    try {
      const users = await deps.slack.listUsers();
      const next = new Map<string, string>();
      for (const u of users) {
        for (const key of [u.handle, u.displayName]) {
          const k = key.trim().toLowerCase();
          if (k) next.set(k, u.id);
        }
      }
      index = next;
      warned.clear();
      deps.log.info({ slackUsers: users.length, indexed: index.size }, "slack directory refreshed");
    } catch (err) {
      // Missing `users:read` scope lands here. Mentions degrade to plain names
      // rather than taking the whole worker down.
      deps.log.warn({ err }, "slack directory refresh failed; mentions fall back to plain names");
    }
  }

  return {
    mention(gitlabUsername, displayName) {
      const key = gitlabUsername.trim().toLowerCase();
      const id = overrides.get(key) ?? index.get(key);
      if (id) return `<@${id}>`;
      if (!warned.has(key)) {
        warned.add(key);
        deps.log.warn({ gitlabUsername }, "no Slack account matched; posting plain name");
      }
      return escapeMrkdwn(displayName);
    },
    setOverrides(next) {
      overrides = new Map(Object.entries(next).map(([k, v]) => [k.toLowerCase(), v]));
    },
    refresh,
    start(refreshMs) {
      if (timer) return;
      timer = setInterval(() => void refresh(), refreshMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
