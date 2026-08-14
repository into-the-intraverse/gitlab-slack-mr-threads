import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KyselyDb } from "../../src/db/index.js";
import { listRecentSettingsChanges } from "../../src/persistence/settings-audit.js";
import { SETTINGS_DEFAULTS } from "../../src/settings/schema.js";
import { makeSettingsStore } from "../../src/settings/store.js";
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

describe("SettingsStore", () => {
  it("returns defaults when nothing was ever written", async () => {
    expect(await makeSettingsStore(db).read()).toEqual(SETTINGS_DEFAULTS);
  });

  it("round-trips every value type", async () => {
    const store = makeSettingsStore(db);
    await store.write(
      {
        default_channel_id: "C123",
        mentions_enabled: false,
        jira_base_url: "https://jira.example.com",
        jira_key_regex: "(ABC|SD)-\\d+",
        user_map: { "a.b": "U999" },
      },
      ACTOR,
    );
    expect(await store.read()).toEqual({
      default_channel_id: "C123",
      mentions_enabled: false,
      jira_base_url: "https://jira.example.com",
      jira_key_regex: "(ABC|SD)-\\d+",
      user_map: { "a.b": "U999" },
    });
  });

  it("leaves untouched keys alone", async () => {
    const store = makeSettingsStore(db);
    await store.write({ default_channel_id: "C123" }, ACTOR);
    await store.write({ mentions_enabled: false }, ACTOR);
    const s = await store.read();
    expect(s.default_channel_id).toBe("C123");
    expect(s.mentions_enabled).toBe(false);
  });

  it("rejects a malformed value and writes nothing", async () => {
    const store = makeSettingsStore(db);
    await expect(store.write({ jira_base_url: "not-a-url" }, ACTOR)).rejects.toThrow();
    expect((await store.read()).jira_base_url).toBeNull();
  });

  it("rejects a Slack id that is not a user id", async () => {
    const store = makeSettingsStore(db);
    await expect(store.write({ user_map: { "a.b": "C123" } }, ACTOR)).rejects.toThrow();
  });

  it("rejects a regex longer than 200 characters", async () => {
    const store = makeSettingsStore(db);
    await expect(store.write({ jira_key_regex: "a".repeat(201) }, ACTOR)).rejects.toThrow();
  });

  it("compiles the ticket regex case-insensitively and re-compiles after a change", async () => {
    const store = makeSettingsStore(db);
    expect("abc-1234").toMatch(await store.jiraKeyRegex());
    await store.write({ jira_key_regex: "ZZZ-\\d+" }, ACTOR);
    const re = await store.jiraKeyRegex();
    expect("abc-1234").not.toMatch(re);
    expect("zzz-9").toMatch(re);
  });

  it("audits one row per changed key, with the actor and both values", async () => {
    const store = makeSettingsStore(db);
    await store.write({ default_channel_id: "C1", mentions_enabled: false }, ACTOR);
    const rows = await listRecentSettingsChanges(db, 10);
    expect(rows).toHaveLength(2);
    const channel = rows.find((r) => r.key === "default_channel_id");
    expect(channel).toMatchObject({
      actor_user_id: "U1",
      actor_name: "Alex",
      scope: "global",
      old_value: "null",
      new_value: '"C1"',
    });
  });

  it("does not audit a write that changes nothing", async () => {
    const store = makeSettingsStore(db);
    await store.write({ default_channel_id: "C1" }, ACTOR);
    await store.write({ default_channel_id: "C1" }, ACTOR);
    expect(await listRecentSettingsChanges(db, 10)).toHaveLength(1);
  });
});
