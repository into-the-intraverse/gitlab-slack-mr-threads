import type { KyselyDb } from "../../db/index.js";
import type { Logger } from "../../logger.js";
import { countFailed, countPending } from "../../persistence/inbox.js";
import { listRecentSettingsChanges } from "../../persistence/settings-audit.js";
import {
  getProject,
  listProjects,
  setProjectChannel,
  setProjectEnabled,
} from "../../settings/projects.js";
import type { Actor } from "../../settings/schema.js";
import type { SettingsStore } from "../../settings/store.js";
import type { Authz } from "../authz.js";
import type { SlackClient } from "../client.js";
import type { SlackDirectory } from "../directory.js";
import {
  MODAL,
  messagesModal,
  parseMessagesModal,
  parseProjectModal,
  projectModal,
} from "./modals.js";
import { ACTION, renderHomeView } from "./view.js";

export type HomeDeps = {
  db: KyselyDb;
  slack: SlackClient;
  settings: SettingsStore;
  authz: Authz;
  directory: SlackDirectory;
  log: Logger;
  socketConnected: () => boolean;
};

export type BlockActionsPayload = {
  user: { id: string; name?: string };
  trigger_id: string;
  actions: Array<{ action_id: string; value?: string; selected_conversation?: string }>;
};

export type ViewSubmissionPayload = {
  user: { id: string; name?: string };
  view: { callback_id: string; private_metadata?: string; state?: unknown };
};

const AUDIT_LIMIT = 5;

const actorOf = (user: { id: string; name?: string }): Actor => ({
  userId: user.id,
  name: user.name ?? user.id,
});

const errors = (errs: Record<string, string>) => ({
  response_action: "errors" as const,
  errors: errs,
});

const NOT_ALLOWED = "Only admins can change settings.";

export async function handleAppHomeOpened(
  deps: HomeDeps,
  payload: { user: string },
): Promise<void> {
  await publish(deps, payload.user);
}

export async function handleBlockActions(
  deps: HomeDeps,
  payload: BlockActionsPayload,
): Promise<void> {
  const action = payload.actions[0];
  if (!action) return;

  // Re-checked here on purpose: hiding a control is convenience, not security.
  // The page may have been opened while this person still had rights.
  if (!(await deps.authz.canEditSettings(payload.user.id))) {
    deps.log.warn({ userId: payload.user.id, action: action.action_id }, "settings: denied");
    await publish(deps, payload.user.id);
    return;
  }

  switch (action.action_id) {
    case ACTION.defaultChannel: {
      const channelId = action.selected_conversation;
      if (!channelId) return;
      const problem = await membershipProblem(deps, channelId);
      if (problem) {
        // There is no response_action outside a modal, so the message goes on
        // the page and the select falls back to the value that is still saved.
        await publish(deps, payload.user.id, problem);
        return;
      }
      await deps.settings.write({ default_channel_id: channelId }, actorOf(payload.user));
      await publish(deps, payload.user.id);
      return;
    }

    case ACTION.editProject: {
      const projectId = Number.parseInt(action.value ?? "", 10);
      if (!Number.isFinite(projectId)) return;
      const project = await getProject(deps.db, projectId);
      if (!project) return;
      await deps.slack.openModal({ triggerId: payload.trigger_id, view: projectModal(project) });
      return;
    }

    case ACTION.editMessages: {
      const settings = await deps.settings.read();
      await deps.slack.openModal({ triggerId: payload.trigger_id, view: messagesModal(settings) });
      return;
    }

    default:
      return;
  }
}

export async function handleViewSubmission(
  deps: HomeDeps,
  payload: ViewSubmissionPayload,
): Promise<{ response_action: "errors"; errors: Record<string, string> } | null> {
  if (!(await deps.authz.canEditSettings(payload.user.id))) {
    deps.log.warn({ userId: payload.user.id }, "settings: submission denied");
    return errors(
      payload.view.callback_id === MODAL.project
        ? { block_channel: NOT_ALLOWED }
        : { block_jira_regex: NOT_ALLOWED },
    );
  }

  const actor = actorOf(payload.user);

  if (payload.view.callback_id === MODAL.project) {
    const parsed = parseProjectModal(payload.view);
    if (!parsed.ok) return errors(parsed.errors);

    if (parsed.value.channelId) {
      const problem = await membershipProblem(deps, parsed.value.channelId);
      if (problem) return errors({ block_channel: problem });
    }

    await setProjectChannel(deps.db, parsed.value.projectId, parsed.value.channelId, actor);
    await setProjectEnabled(deps.db, parsed.value.projectId, parsed.value.enabled, actor);
    await publish(deps, payload.user.id);
    return null;
  }

  if (payload.view.callback_id === MODAL.messages) {
    const parsed = parseMessagesModal(payload.view);
    if (!parsed.ok) return errors(parsed.errors);

    await deps.settings.write(parsed.value, actor);
    // `user_map` is a hot setting, so the live index has to hear about it.
    deps.directory.setOverrides(parsed.value.user_map);
    await publish(deps, payload.user.id);
    return null;
  }

  return null;
}

async function membershipProblem(deps: HomeDeps, channelId: string): Promise<string | null> {
  try {
    const channel = await deps.slack.getChannel(channelId);
    if (channel.isMember) return null;
    return `The bot is not in #${channel.name} — invite it with /invite.`;
  } catch (err) {
    deps.log.warn({ err, channelId }, "settings: channel lookup failed");
    return "Could not check that channel. Try again.";
  }
}

async function publish(deps: HomeDeps, userId: string, channelError?: string): Promise<void> {
  try {
    const [settings, projects, audit, pending, failed, threads, canEdit] = await Promise.all([
      deps.settings.read(),
      listProjects(deps.db),
      listRecentSettingsChanges(deps.db, AUDIT_LIMIT),
      countPending(deps.db),
      countFailed(deps.db),
      countThreads(deps.db),
      deps.authz.canEditSettings(userId),
    ]);

    const view = renderHomeView({
      settings,
      projects,
      audit,
      health: { socketConnected: deps.socketConnected(), pending, failed, threads },
      canEdit,
      ...(channelError ? { channelError } : {}),
      nowMs: Date.now(),
    });

    await deps.slack.publishHome({ userId, view });
  } catch (err) {
    // The setting is already applied; the page corrects itself when next opened.
    deps.log.error({ err, userId }, "settings: publishing App Home failed");
  }
}

async function countThreads(db: KyselyDb): Promise<number> {
  const row = await db
    .selectFrom("mr_threads")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .executeTakeFirstOrThrow();
  return Number(row.n);
}
