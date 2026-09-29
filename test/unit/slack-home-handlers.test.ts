import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KyselyDb } from "../../src/db/index.js";
import { insertMrThread } from "../../src/persistence/mr-threads.js";
import { listRecentSettingsChanges } from "../../src/persistence/settings-audit.js";
import { getProject, setProjectChannel, touchProject } from "../../src/settings/projects.js";
import { makeSettingsStore } from "../../src/settings/store.js";
import { makeAuthz } from "../../src/slack/authz.js";
import { makeSlackDirectory } from "../../src/slack/directory.js";
import {
  type HomeDeps,
  handleAppHomeOpened,
  handleBlockActions,
  handleViewSubmission,
} from "../../src/slack/home/handlers.js";
import { MODAL } from "../../src/slack/home/modals.js";
import { ACTION } from "../../src/slack/home/view.js";
import { FakeSlackClient } from "../helpers/fake-slack.js";
import { createTestDb } from "../helpers/test-db.js";

const log = pino({ level: "silent" });
const ADMIN = { id: "U-ADMIN", name: "Alex" };
const ADMIN_ACTOR = { userId: ADMIN.id, name: ADMIN.name };
const MEMBER = { id: "U-MEMBER", name: "Sam" };

let db: KyselyDb;
let cleanup: () => Promise<void>;
let slack: FakeSlackClient;
let deps: HomeDeps;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
  slack = new FakeSlackClient();
  slack.channels.set("C-OK", { id: "C-OK", name: "backend-mr", isMember: true });
  slack.channels.set("C-NOT-IN", { id: "C-NOT-IN", name: "secret", isMember: false });
  const settings = makeSettingsStore(db);
  const directory = makeSlackDirectory({ slack, log, overrides: {} });
  deps = {
    db,
    slack,
    settings,
    directory,
    log,
    authz: makeAuthz({ slack, log, adminUserIds: [ADMIN.id] }),
    socketConnected: () => true,
  };
});
afterEach(async () => {
  await cleanup();
});

describe("app_home_opened", () => {
  it("publishes a page with controls for an admin", async () => {
    await handleAppHomeOpened(deps, { user: ADMIN.id });
    expect(JSON.stringify(slack.publishedHome.get(ADMIN.id))).toContain(ACTION.defaultChannel);
  });

  it("counts the threads it is tracking", async () => {
    await handleAppHomeOpened(deps, { user: ADMIN.id });
    expect(JSON.stringify(slack.publishedHome.get(ADMIN.id))).toContain("0 threads");

    await insertMrThread(db, {
      project_id: 1,
      mr_iid: 1,
      slack_channel_id: "C1",
      slack_thread_ts: "1.1",
      jira_key: null,
      title: "t",
      author_name: "A",
      author_username: null,
      source_branch: "b",
      target_branch: "master",
      web_url: "https://example.com/mr/1",
      status: "open",
      last_parent_hash: "h",
    });

    await handleAppHomeOpened(deps, { user: ADMIN.id });
    expect(JSON.stringify(slack.publishedHome.get(ADMIN.id))).toContain("1 threads");
  });

  it("publishes a page without controls for a plain member", async () => {
    await handleAppHomeOpened(deps, { user: MEMBER.id });
    expect(JSON.stringify(slack.publishedHome.get(MEMBER.id))).not.toContain(ACTION.editMessages);
  });
});

describe("picking the default channel", () => {
  const pick = (user: { id: string; name?: string }, channel: string) =>
    handleBlockActions(deps, {
      user,
      trigger_id: "T1",
      actions: [{ action_id: ACTION.defaultChannel, selected_conversation: channel }],
    });

  it("saves a channel the bot is in", async () => {
    await pick(ADMIN, "C-OK");
    expect((await deps.settings.read()).default_channel_id).toBe("C-OK");
  });

  it("refuses a channel the bot is not in and says so on the page", async () => {
    await pick(ADMIN, "C-NOT-IN");
    expect((await deps.settings.read()).default_channel_id).toBeNull();
    expect(JSON.stringify(slack.publishedHome.get(ADMIN.id))).toContain("not in");
  });

  it("refuses a plain member even though the page hid the control", async () => {
    await pick(MEMBER, "C-OK");
    expect((await deps.settings.read()).default_channel_id).toBeNull();
  });

  it("republishes the page after a successful save", async () => {
    await pick(ADMIN, "C-OK");
    expect(JSON.stringify(slack.publishedHome.get(ADMIN.id))).toContain("C-OK");
  });
});

describe("clicks the handler should ignore", () => {
  const click = (actions: Array<Record<string, unknown>>) =>
    handleBlockActions(deps, {
      user: ADMIN,
      trigger_id: "T1",
      actions: actions as never,
    });

  it("does nothing when the payload carries no action", async () => {
    await click([]);
    expect(slack.openedModals).toHaveLength(0);
    expect(slack.publishedHome.size).toBe(0);
  });

  it("does nothing for an action_id it does not know", async () => {
    await click([{ action_id: "settings_something_new" }]);
    expect(slack.openedModals).toHaveLength(0);
  });

  it("ignores a channel select that came back empty", async () => {
    await click([{ action_id: ACTION.defaultChannel }]);
    expect((await deps.settings.read()).default_channel_id).toBeNull();
    // Not even a re-render: there is nothing to say about a click that carried
    // no channel, and republishing would flash an error the user did not cause.
    expect(slack.publishedHome.size).toBe(0);
  });

  it("ignores an edit button with no project id, or one nobody has seen", async () => {
    await click([{ action_id: ACTION.editProject }]);
    await click([{ action_id: ACTION.editProject, value: "not-a-number" }]);
    await click([{ action_id: ACTION.editProject, value: "999" }]);
    expect(slack.openedModals).toHaveLength(0);
  });
});

describe("when Slack itself misbehaves", () => {
  it("says so on the page when the channel cannot be checked", async () => {
    slack.getChannelError = new Error("ratelimited");

    await handleBlockActions(deps, {
      user: ADMIN,
      trigger_id: "T1",
      actions: [{ action_id: ACTION.defaultChannel, selected_conversation: "C-OK" }],
    });

    expect(JSON.stringify(slack.publishedHome.get(ADMIN.id))).toContain("Could not check");
    expect((await deps.settings.read()).default_channel_id).toBeNull();
  });

  it("puts the same message on the modal field", async () => {
    await touchProject(db, { projectId: 12345, name: "api-gateway" });
    slack.getChannelError = new Error("ratelimited");

    const r = await handleViewSubmission(deps, {
      user: ADMIN,
      view: {
        callback_id: MODAL.project,
        private_metadata: "12345",
        state: {
          values: {
            block_use_default: { use_default: { selected_options: [] } },
            block_channel: { channel: { selected_conversation: "C-OK" } },
            block_enabled: { enabled: { selected_options: [] } },
          },
        },
      },
    });

    expect(r?.errors.block_channel).toMatch(/Could not check/);
  });

  it("swallows a failed publish: the setting is saved either way", async () => {
    slack.publishHomeError = new Error("view_expired");

    await expect(handleAppHomeOpened(deps, { user: ADMIN.id })).resolves.toBeUndefined();
  });
});

describe("opening a modal", () => {
  it("opens the project modal for an admin", async () => {
    await touchProject(db, { projectId: 12345, name: "api-gateway" });
    await handleBlockActions(deps, {
      user: ADMIN,
      trigger_id: "T1",
      actions: [{ action_id: ACTION.editProject, value: "12345" }],
    });
    expect(slack.openedModals).toHaveLength(1);
    expect(JSON.stringify(slack.openedModals[0])).toContain("api-gateway");
  });

  it("opens nothing for a plain member", async () => {
    await touchProject(db, { projectId: 12345, name: "api-gateway" });
    await handleBlockActions(deps, {
      user: MEMBER,
      trigger_id: "T1",
      actions: [{ action_id: ACTION.editProject, value: "12345" }],
    });
    expect(slack.openedModals).toHaveLength(0);
  });

  it("opens the messages modal pre-filled with what is saved", async () => {
    await deps.settings.write({ jira_base_url: "https://jira.example.com" }, ADMIN_ACTOR);

    await handleBlockActions(deps, {
      user: ADMIN,
      trigger_id: "T1",
      actions: [{ action_id: ACTION.editMessages }],
    });

    expect(slack.openedModals).toHaveLength(1);
    expect(JSON.stringify(slack.openedModals[0])).toContain("https://jira.example.com");
  });
});

describe("submitting the project modal", () => {
  const submit = (user: { id: string; name?: string }, channel: string) =>
    handleViewSubmission(deps, {
      user,
      view: {
        callback_id: MODAL.project,
        private_metadata: "12345",
        state: {
          values: {
            block_use_default: { use_default: { selected_options: [] } },
            block_channel: { channel: { selected_conversation: channel } },
            block_enabled: { enabled: { selected_options: [{ value: "on" }] } },
          },
        },
      },
    });

  beforeEach(async () => {
    await touchProject(db, { projectId: 12345, name: "api-gateway" });
  });

  it("saves and returns no errors", async () => {
    expect(await submit(ADMIN, "C-OK")).toBeNull();
    expect((await getProject(db, 12345))?.channel_id).toBe("C-OK");
  });

  it("returns a field error when the bot is not in the channel", async () => {
    const r = await submit(ADMIN, "C-NOT-IN");
    expect(r?.response_action).toBe("errors");
    expect(r?.errors.block_channel).toMatch(/not in/i);
    expect((await getProject(db, 12345))?.channel_id).toBeNull();
  });

  it("refuses a plain member", async () => {
    const r = await submit(MEMBER, "C-OK");
    expect(r?.response_action).toBe("errors");
    expect(r?.errors.block_channel).toBe("Only admins can change settings.");
    expect((await getProject(db, 12345))?.channel_id).toBeNull();
  });

  it("saves a project back onto the default channel without checking membership", async () => {
    await setProjectChannel(db, 12345, "C-OK", { userId: ADMIN.id, name: ADMIN.name });
    // The bot is not in this one, but "use the default" is not a channel pick.
    slack.getChannelError = new Error("should not be consulted");

    const r = await handleViewSubmission(deps, {
      user: ADMIN,
      view: {
        callback_id: MODAL.project,
        private_metadata: "12345",
        state: {
          values: {
            block_use_default: { use_default: { selected_options: [{ value: "yes" }] } },
            block_channel: { channel: { selected_conversation: "C-NOT-IN" } },
            block_enabled: { enabled: { selected_options: [{ value: "on" }] } },
          },
        },
      },
    });

    expect(r).toBeNull();
    expect((await getProject(db, 12345))?.channel_id).toBeNull();
  });
});

describe("a plain member submitting the messages modal", () => {
  it("gets the refusal on a field that modal actually has", async () => {
    const r = await handleViewSubmission(deps, {
      user: MEMBER,
      view: { callback_id: MODAL.messages, state: { values: {} } },
    });

    // Slack drops a response_action.errors entry whose block_id is not in the
    // open view, so naming the project modal's block here would show nothing.
    expect(r?.errors).toEqual({ block_jira_regex: "Only admins can change settings." });
  });
});

describe("submitting the messages modal", () => {
  it("applies user overrides to the live directory", async () => {
    slack.users = [];
    await deps.directory.refresh();
    expect(deps.directory.mention("a.b", "A B")).toBe("A B");

    const r = await handleViewSubmission(deps, {
      user: ADMIN,
      view: {
        callback_id: MODAL.messages,
        state: {
          values: {
            block_mentions: { mentions: { selected_options: [{ value: "on" }] } },
            block_jira_url: { jira_url: { value: "" } },
            block_jira_regex: { jira_regex: { value: "ABC-\\d+" } },
            block_user_map: { user_map: { value: "a.b = U777" } },
          },
        },
      },
    });

    expect(r).toBeNull();
    expect(deps.directory.mention("a.b", "A B")).toBe("<@U777>");
  });

  it("returns the parse error without saving", async () => {
    const r = await handleViewSubmission(deps, {
      user: ADMIN,
      view: {
        callback_id: MODAL.messages,
        state: {
          values: {
            block_mentions: { mentions: { selected_options: [] } },
            block_jira_url: { jira_url: { value: "nope" } },
            block_jira_regex: { jira_regex: { value: "ABC-\\d+" } },
            block_user_map: { user_map: { value: "" } },
          },
        },
      },
    });
    expect(r?.errors.block_jira_url).toBeTruthy();
    expect((await deps.settings.read()).jira_base_url).toBeNull();
  });
});

describe("submissions the handler should ignore", () => {
  it("returns no errors for a modal it does not own", async () => {
    const r = await handleViewSubmission(deps, {
      user: ADMIN,
      view: { callback_id: "something_else", state: { values: {} } },
    });
    expect(r).toBeNull();
  });

  it("returns the field error when the project modal cannot be read", async () => {
    const r = await handleViewSubmission(deps, {
      user: ADMIN,
      view: { callback_id: MODAL.project, state: { values: {} } },
    });
    expect(r?.errors.block_channel).toMatch(/which project/i);
  });
});

describe("who the audit says made the change", () => {
  it("falls back to the Slack id when the payload carries no name", async () => {
    await handleBlockActions(deps, {
      user: { id: ADMIN.id },
      trigger_id: "T1",
      actions: [{ action_id: ACTION.defaultChannel, selected_conversation: "C-OK" }],
    });

    const [row] = await listRecentSettingsChanges(db, 1);
    expect(row).toMatchObject({ actor_user_id: ADMIN.id, actor_name: ADMIN.id });
  });
});
