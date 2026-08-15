import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KyselyDb } from "../../src/db/index.js";
import { getProject, touchProject } from "../../src/settings/projects.js";
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
    expect((await getProject(db, 12345))?.channel_id).toBeNull();
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
