import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { type SlackDirectory, makeSlackDirectory } from "../../src/slack/directory.js";
import { FakeSlackClient } from "../helpers/fake-slack.js";

const log = pino({ level: "silent" });

let slack: FakeSlackClient;
beforeEach(() => {
  slack = new FakeSlackClient();
  slack.users = [
    { id: "U_JAN", handle: "jan.kowalski", displayName: "" },
    { id: "U_ANNA", handle: "a.nowak", displayName: "anna.nowak" },
  ];
});

const build = async (overrides: Record<string, string> = {}): Promise<SlackDirectory> => {
  const d = makeSlackDirectory({ slack, log, overrides });
  await d.refresh();
  return d;
};

describe("makeSlackDirectory", () => {
  it("matches a GitLab username against the Slack handle", async () => {
    const d = await build();
    expect(d.mention("jan.kowalski", "Jan Kowalski")).toBe("<@U_JAN>");
  });

  it("matches against the display name when the handle differs", async () => {
    const d = await build();
    expect(d.mention("anna.nowak", "Anna Nowak")).toBe("<@U_ANNA>");
  });

  it("is case-insensitive", async () => {
    const d = await build();
    expect(d.mention("Jan.Kowalski", "Jan Kowalski")).toBe("<@U_JAN>");
  });

  it("prefers an explicit override over the directory", async () => {
    const d = await build({ "jan.kowalski": "U_OVERRIDE" });
    expect(d.mention("jan.kowalski", "Jan Kowalski")).toBe("<@U_OVERRIDE>");
  });

  it("maps someone missing from Slack to a plain, escaped name", async () => {
    const d = await build();
    expect(d.mention("ghost.user", "Ghost <User> & Co")).toBe("Ghost &lt;User&gt; &amp; Co");
  });

  it("degrades to plain names when users.list fails (missing users:read scope)", async () => {
    slack.listUsersError = new Error("missing_scope");
    const d = makeSlackDirectory({ slack, log, overrides: {} });
    await expect(d.refresh()).resolves.toBeUndefined();
    expect(d.mention("jan.kowalski", "Jan Kowalski")).toBe("Jan Kowalski");
  });

  it("still honours overrides when the directory could not load", async () => {
    slack.listUsersError = new Error("missing_scope");
    const d = makeSlackDirectory({ slack, log, overrides: { "jan.kowalski": "U_OVERRIDE" } });
    await d.refresh();
    expect(d.mention("jan.kowalski", "Jan Kowalski")).toBe("<@U_OVERRIDE>");
  });

  it("applies new overrides without a restart", async () => {
    const d = await build();
    expect(d.mention("a.b", "A B")).toBe("A B");
    d.setOverrides({ "a.b": "U777" });
    expect(d.mention("a.b", "A B")).toBe("<@U777>");
  });
});
