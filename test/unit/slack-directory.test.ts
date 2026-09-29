import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

  it("ignores whitespace around either side of the match", async () => {
    slack.users = [{ id: "U_PAD", handle: "  pad.ded  ", displayName: "" }];
    const d = await build();

    expect(d.mention("pad.ded", "Pad Ded")).toBe("<@U_PAD>");
    expect(d.mention("  pad.ded  ", "Pad Ded")).toBe("<@U_PAD>");
  });

  it("does not index a member who has neither a handle nor a display name", async () => {
    slack.users = [{ id: "U_BLANK", handle: "", displayName: "" }];
    const d = await build();

    // Otherwise an empty GitLab username would mention whoever is blank.
    expect(d.mention("", "Nobody")).toBe("Nobody");
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

  it("picks up people who joined Slack after the last refresh", async () => {
    const d = await build();
    expect(d.mention("new.hire", "New Hire")).toBe("New Hire");

    slack.users = [...slack.users, { id: "U_NEW", handle: "new.hire", displayName: "" }];
    await d.refresh();

    expect(d.mention("new.hire", "New Hire")).toBe("<@U_NEW>");
  });
});

// A worker processing a hundred events would otherwise log the same unmatched
// name a hundred times, which is how a real signal gets buried.
describe("warning about someone Slack does not know", () => {
  it("warns once per name, not once per message", async () => {
    const warn = vi.spyOn(log, "warn");
    const d = await build();

    d.mention("ghost.user", "Ghost User");
    d.mention("ghost.user", "Ghost User");
    d.mention("other.ghost", "Other Ghost");

    const unmatched = warn.mock.calls.filter(
      (c) => c[1] === "no Slack account matched; posting plain name",
    );
    expect(unmatched).toHaveLength(2);
    warn.mockRestore();
  });

  it("warns again after a refresh, in case the directory changed", async () => {
    const warn = vi.spyOn(log, "warn");
    const d = await build();

    d.mention("ghost.user", "Ghost User");
    await d.refresh();
    d.mention("ghost.user", "Ghost User");

    const unmatched = warn.mock.calls.filter(
      (c) => c[1] === "no Slack account matched; posting plain name",
    );
    expect(unmatched).toHaveLength(2);
    warn.mockRestore();
  });

  it("says so when the directory could not be loaded at all", async () => {
    const warn = vi.spyOn(log, "warn");
    slack.listUsersError = new Error("missing_scope");

    await makeSlackDirectory({ slack, log, overrides: {} }).refresh();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.anything() }),
      "slack directory refresh failed; mentions fall back to plain names",
    );
    warn.mockRestore();
  });
});

describe("the background refresh", () => {
  it("keeps refreshing on the interval until it is stopped", async () => {
    const listUsers = vi.spyOn(slack, "listUsers");
    const d = makeSlackDirectory({ slack, log, overrides: {} });

    d.start(5);
    await vi.waitFor(() => expect(listUsers.mock.calls.length).toBeGreaterThan(1));
    d.stop();

    const afterStop = listUsers.mock.calls.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(listUsers.mock.calls.length).toBe(afterStop);
  });

  it("ignores a second start so one directory keeps one timer", async () => {
    const d = makeSlackDirectory({ slack, log, overrides: {} });
    const listUsers = vi.spyOn(slack, "listUsers");

    d.start(5);
    d.start(5);
    await vi.waitFor(() => expect(listUsers.mock.calls.length).toBeGreaterThan(0));
    const seen = listUsers.mock.calls.length;
    d.stop();

    // Two timers would have doubled the calls in the same window.
    await new Promise((r) => setTimeout(r, 20));
    expect(listUsers.mock.calls.length).toBe(seen);
  });

  it("can be stopped before it was ever started", () => {
    expect(() => makeSlackDirectory({ slack, log, overrides: {} }).stop()).not.toThrow();
  });
});
