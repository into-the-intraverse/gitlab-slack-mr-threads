import type { Logger } from "../logger.js";
import type { SlackClient } from "./client.js";

export type Authz = {
  canEditSettings(userId: string): Promise<boolean>;
};

export type AuthzDeps = {
  slack: SlackClient;
  log: Logger;
  /**
   * From `SLACK_ADMIN_USER_IDS`. Deliberately env-only and never stored in the
   * database: if the panel could edit this list, the first admin could grant
   * access to anyone and the permission model would stop meaning anything.
   */
  adminUserIds: string[];
};

export function makeAuthz(deps: AuthzDeps): Authz {
  const allowlist = new Set(deps.adminUserIds);

  return {
    async canEditSettings(userId) {
      if (allowlist.has(userId)) return true;
      try {
        // Deliberately not read from the SlackDirectory cache: that is up to 15
        // minutes old and would leave a demoted admin with access for that long.
        const user = await deps.slack.getUser(userId);
        return user.isAdmin || user.isOwner;
      } catch (err) {
        // Fail closed. An unreachable Slack API must not become an open door.
        deps.log.warn({ err, userId }, "authz: user lookup failed; denying");
        return false;
      }
    },
  };
}
