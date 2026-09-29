import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KyselyDb } from "../../src/db/index.js";
import { touchProject } from "../../src/settings/projects.js";
import { makeSettingsStore } from "../../src/settings/store.js";
import { makeAuthz } from "../../src/slack/authz.js";
import { makeSlackDirectory } from "../../src/slack/directory.js";
import type { HomeDeps } from "../../src/slack/home/handlers.js";
import { MODAL } from "../../src/slack/home/modals.js";
import { routeSocketEvent } from "../../src/slack/home/route.js";
import { ACTION } from "../../src/slack/home/view.js";
import { FakeSlackClient } from "../helpers/fake-slack.js";
import { createTestDb } from "../helpers/test-db.js";

const log = pino({ level: "silent" });
const ADMIN = { id: "U-ADMIN", name: "Alex" };

let db: KyselyDb;
let cleanup: () => Promise<void>;
let slack: FakeSlackClient;
let deps: HomeDeps;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
  slack = new FakeSlackClient();
  slack.channels.set("C-OK", { id: "C-OK", name: "backend-mr", isMember: true });
  deps = {
    db,
    slack,
    settings: makeSettingsStore(db),
    directory: makeSlackDirectory({ slack, log, overrides: {} }),
    log,
    authz: makeAuthz({ slack, log, adminUserIds: [ADMIN.id] }),
    socketConnected: () => true,
  };
});
afterEach(async () => {
  await cleanup();
});

describe("routeSocketEvent", () => {
  it("publishes the page when someone opens the Home tab", async () => {
    await routeSocketEvent(deps, "events_api", {
      event: { type: "app_home_opened", user: ADMIN.id },
    });
    expect(slack.publishedHome.has(ADMIN.id)).toBe(true);
  });

  it("ignores other Events API events", async () => {
    await routeSocketEvent(deps, "events_api", {
      event: { type: "message", user: ADMIN.id },
    });
    expect(slack.publishedHome.size).toBe(0);
  });

  // Slack sends url_verification and a few other bodies with no `event` at all.
  it("survives an Events API body with no event in it", async () => {
    await expect(routeSocketEvent(deps, "events_api", {})).resolves.toBeUndefined();
    await expect(
      routeSocketEvent(deps, "events_api", { event: { type: "app_home_opened" } }),
    ).resolves.toBeUndefined();
    expect(slack.publishedHome.size).toBe(0);
  });

  it("reads the kind of interaction from the payload, not the envelope", async () => {
    await touchProject(db, { projectId: 12345, name: "api-gateway" });
    // The envelope says `interactive`; only the payload knows it is a click.
    await routeSocketEvent(deps, "interactive", {
      type: "block_actions",
      user: ADMIN,
      trigger_id: "T1",
      actions: [{ action_id: ACTION.editProject, value: "12345" }],
    });
    expect(slack.openedModals).toHaveLength(1);
  });

  it("acknowledges a clean submission with nothing", async () => {
    const r = await routeSocketEvent(deps, "interactive", {
      type: "view_submission",
      user: ADMIN,
      view: {
        callback_id: MODAL.messages,
        state: {
          values: {
            block_mentions: { mentions: { selected_options: [] } },
            block_jira_url: { jira_url: { value: "" } },
            block_jira_regex: { jira_regex: { value: "ABC-\\d+" } },
            block_user_map: { user_map: { value: "" } },
          },
        },
      },
    });
    expect(r).toBeUndefined();
  });

  it("passes a rejected submission back so the modal stays open", async () => {
    const r = await routeSocketEvent(deps, "interactive", {
      type: "view_submission",
      user: { id: "U-MEMBER", name: "Sam" },
      view: { callback_id: MODAL.messages, state: { values: {} } },
    });
    expect(r).toMatchObject({ response_action: "errors" });
  });

  it("ignores an envelope it does not handle", async () => {
    await routeSocketEvent(deps, "slash_commands", { command: "/whatever" });
    expect(slack.publishedHome.size).toBe(0);
    expect(slack.openedModals).toHaveLength(0);
  });
});
