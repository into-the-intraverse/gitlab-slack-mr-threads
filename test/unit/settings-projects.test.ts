import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KyselyDb } from "../../src/db/index.js";
import { listRecentSettingsChanges } from "../../src/persistence/settings-audit.js";
import {
  getProject,
  listProjects,
  setProjectChannel,
  setProjectEnabled,
  touchProject,
} from "../../src/settings/projects.js";
import { createTestDb } from "../helpers/test-db.js";

const ACTOR = { userId: "U1", name: "Alex" };

let db: KyselyDb;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ db, cleanup } = await createTestDb());
});
afterEach(async () => {
  await cleanup();
});

describe("project settings", () => {
  it("creates a row on first sight, enabled and on the default channel", async () => {
    await touchProject(db, { projectId: 12345, name: "api-gateway", webUrl: "https://g/x" });
    expect(await getProject(db, 12345)).toMatchObject({
      project_id: 12345,
      name: "api-gateway",
      web_url: "https://g/x",
      channel_id: null,
      enabled: true,
    });
  });

  it("names a project the payload did not name", async () => {
    await touchProject(db, { projectId: 777 });
    expect((await getProject(db, 777))?.name).toBe("Project 777");
  });

  it("does not overwrite a known name with the placeholder", async () => {
    await touchProject(db, { projectId: 777, name: "web-client" });
    await touchProject(db, { projectId: 777 });
    expect((await getProject(db, 777))?.name).toBe("web-client");
  });

  it("never overwrites an admin's channel or off switch", async () => {
    await touchProject(db, { projectId: 12345, name: "api-gateway" });
    await setProjectChannel(db, 12345, "C-BACKEND", ACTOR);
    await setProjectEnabled(db, 12345, false, ACTOR);

    await touchProject(db, { projectId: 12345, name: "api-gateway-renamed" });

    const p = await getProject(db, 12345);
    expect(p?.channel_id).toBe("C-BACKEND");
    expect(p?.enabled).toBe(false);
    expect(p?.name).toBe("api-gateway-renamed");
  });

  it("returns null for a project nobody has seen", async () => {
    expect(await getProject(db, 999)).toBeNull();
  });

  it("lists projects by name", async () => {
    await touchProject(db, { projectId: 2, name: "web-client" });
    await touchProject(db, { projectId: 1, name: "api-gateway" });
    expect((await listProjects(db)).map((p) => p.name)).toEqual(["api-gateway", "web-client"]);
  });

  it("audits a channel change under the project's scope", async () => {
    await touchProject(db, { projectId: 12345, name: "api-gateway" });
    await setProjectChannel(db, 12345, "C-BACKEND", ACTOR);
    const [row] = await listRecentSettingsChanges(db, 10);
    expect(row).toMatchObject({
      scope: "project:12345",
      key: "channel_id",
      old_value: "null",
      new_value: '"C-BACKEND"',
      actor_user_id: "U1",
    });
  });

  it("clears a channel back to the default", async () => {
    await touchProject(db, { projectId: 12345, name: "api-gateway" });
    await setProjectChannel(db, 12345, "C-BACKEND", ACTOR);
    await setProjectChannel(db, 12345, null, ACTOR);
    expect((await getProject(db, 12345))?.channel_id).toBeNull();
  });

  it("does not audit a change that changes nothing", async () => {
    await touchProject(db, { projectId: 12345, name: "api-gateway" });
    await setProjectEnabled(db, 12345, true, ACTOR);
    expect(await listRecentSettingsChanges(db, 10)).toHaveLength(0);
  });

  it("refuses to configure a project nobody has seen", async () => {
    await expect(setProjectChannel(db, 999, "C-X", ACTOR)).rejects.toThrow(/999/);
  });

  it("switches a project back on after it was switched off", async () => {
    await touchProject(db, { projectId: 12345, name: "api-gateway" });
    await setProjectEnabled(db, 12345, false, ACTOR);
    await setProjectEnabled(db, 12345, true, ACTOR);

    expect((await getProject(db, 12345))?.enabled).toBe(true);
    expect((await listRecentSettingsChanges(db, 10)).map((r) => r.new_value)).toEqual([
      "true",
      "false",
    ]);
  });
});
