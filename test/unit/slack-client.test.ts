import { beforeEach, describe, expect, it, vi } from "vitest";

// The real client is thin, but every fallback in it hides a Slack response the
// API is allowed to send: a missing ts, a page cursor, a member with no
// display_name. Those are the branches under test.
const h = vi.hoisted(() => {
  const web = {
    chat: { postMessage: vi.fn(), update: vi.fn() },
    users: { list: vi.fn(), info: vi.fn() },
    views: { publish: vi.fn(), open: vi.fn() },
    conversations: { info: vi.fn() },
  };
  const built: Array<{ token: string; options: unknown }> = [];
  return { web, built };
});

vi.mock("@slack/web-api", () => ({
  WebClient: vi.fn(function WebClient(token: string, options: unknown) {
    h.built.push({ token, options });
    return h.web;
  }),
}));

import { makeRealSlackClient } from "../../src/slack/client.js";

const member = (over: Record<string, unknown>) => ({ id: "U1", name: "a.b", ...over });

beforeEach(() => {
  h.built.length = 0;
  for (const group of Object.values(h.web)) {
    for (const fn of Object.values(group)) fn.mockReset().mockResolvedValue({});
  }
});

describe("makeRealSlackClient", () => {
  it("builds the WebClient with the bot token and Slack's own address", () => {
    makeRealSlackClient("xoxb-123");
    expect(h.built).toEqual([{ token: "xoxb-123", options: {} }]);
  });

  it("points at another address when one is configured", () => {
    // An egress proxy in production, a stub server in the end-to-end test.
    makeRealSlackClient("xoxb-123", "http://127.0.0.1:9999/api/");
    expect(h.built[0]?.options).toEqual({ slackApiUrl: "http://127.0.0.1:9999/api/" });

    makeRealSlackClient("xoxb-123", null);
    expect(h.built[1]?.options).toEqual({});
  });
});

describe("postParent", () => {
  it("returns the ts Slack assigned", async () => {
    h.web.chat.postMessage.mockResolvedValue({ ts: "1.1" });
    const r = await makeRealSlackClient("t").postParent({ channel: "C1", text: "hi", blocks: [] });
    expect(r).toEqual({ ts: "1.1" });
    expect(h.web.chat.postMessage).toHaveBeenCalledWith({ channel: "C1", text: "hi", blocks: [] });
  });

  it("throws when the response carries no ts", async () => {
    h.web.chat.postMessage.mockResolvedValue({ ok: true });
    await expect(
      makeRealSlackClient("t").postParent({ channel: "C1", text: "hi", blocks: [] }),
    ).rejects.toThrow(/no ts/);
  });
});

describe("updateParent and postReply", () => {
  it("updates the parent in place", async () => {
    await makeRealSlackClient("t").updateParent({
      channel: "C1",
      ts: "1.1",
      text: "hi",
      blocks: [{ type: "divider" }],
    });
    expect(h.web.chat.update).toHaveBeenCalledWith({
      channel: "C1",
      ts: "1.1",
      text: "hi",
      blocks: [{ type: "divider" }],
    });
  });

  it("posts a reply into the thread", async () => {
    await makeRealSlackClient("t").postReply({ channel: "C1", threadTs: "1.1", text: "yo" });
    expect(h.web.chat.postMessage).toHaveBeenCalledWith({
      channel: "C1",
      thread_ts: "1.1",
      text: "yo",
    });
  });
});

describe("listUsers", () => {
  it("follows the cursor until the last page", async () => {
    h.web.users.list
      .mockResolvedValueOnce({
        members: [member({ id: "U1" })],
        response_metadata: { next_cursor: "c2" },
      })
      .mockResolvedValueOnce({ members: [member({ id: "U2", name: "c.d" })] });

    const users = await makeRealSlackClient("t").listUsers();

    expect(users.map((u) => u.id)).toEqual(["U1", "U2"]);
    expect(h.web.users.list).toHaveBeenNthCalledWith(1, { limit: 200 });
    expect(h.web.users.list).toHaveBeenNthCalledWith(2, { limit: 200, cursor: "c2" });
  });

  it("stops on an empty cursor rather than looping forever", async () => {
    h.web.users.list.mockResolvedValue({ members: [], response_metadata: { next_cursor: "" } });
    await expect(makeRealSlackClient("t").listUsers()).resolves.toEqual([]);
    expect(h.web.users.list).toHaveBeenCalledTimes(1);
  });

  it("skips bots, deleted members, Slackbot and members with no id", async () => {
    h.web.users.list.mockResolvedValue({
      members: [
        member({ id: "U-BOT", is_bot: true }),
        member({ id: "U-GONE", deleted: true }),
        member({ id: "USLACKBOT" }),
        member({ id: undefined }),
        member({ id: "U-REAL" }),
      ],
    });
    const users = await makeRealSlackClient("t").listUsers();
    expect(users.map((u) => u.id)).toEqual(["U-REAL"]);
  });

  it("treats a missing handle or display name as empty", async () => {
    h.web.users.list.mockResolvedValue({
      members: [member({ id: "U1", name: undefined }), member({ id: "U2", profile: {} })],
    });
    const users = await makeRealSlackClient("t").listUsers();
    expect(users).toEqual([
      { id: "U1", handle: "", displayName: "" },
      { id: "U2", handle: "a.b", displayName: "" },
    ]);
  });

  it("keeps the display name when the profile carries one", async () => {
    h.web.users.list.mockResolvedValue({
      members: [member({ id: "U1", profile: { display_name: "Ann B" } })],
    });
    await expect(makeRealSlackClient("t").listUsers()).resolves.toEqual([
      { id: "U1", handle: "a.b", displayName: "Ann B" },
    ]);
  });

  it("survives a page with no members array", async () => {
    h.web.users.list.mockResolvedValue({});
    await expect(makeRealSlackClient("t").listUsers()).resolves.toEqual([]);
  });
});

describe("home and modals", () => {
  it("publishes the App Home view", async () => {
    await makeRealSlackClient("t").publishHome({ userId: "U1", view: { type: "home" } });
    expect(h.web.views.publish).toHaveBeenCalledWith({ user_id: "U1", view: { type: "home" } });
  });

  it("opens a modal against the trigger id", async () => {
    await makeRealSlackClient("t").openModal({ triggerId: "T1", view: { type: "modal" } });
    expect(h.web.views.open).toHaveBeenCalledWith({ trigger_id: "T1", view: { type: "modal" } });
  });
});

describe("getChannel", () => {
  it("reports membership when Slack says the bot is in", async () => {
    h.web.conversations.info.mockResolvedValue({ channel: { name: "backend", is_member: true } });
    await expect(makeRealSlackClient("t").getChannel("C1")).resolves.toEqual({
      id: "C1",
      name: "backend",
      isMember: true,
    });
  });

  it("falls back to the id and assumes no membership when the channel is missing", async () => {
    h.web.conversations.info.mockResolvedValue({});
    await expect(makeRealSlackClient("t").getChannel("C1")).resolves.toEqual({
      id: "C1",
      name: "C1",
      isMember: false,
    });
  });
});

describe("getUser", () => {
  it("prefers the display name", async () => {
    h.web.users.info.mockResolvedValue({
      user: { profile: { display_name: "Ann" }, real_name: "Ann B", name: "a.b" },
    });
    await expect(makeRealSlackClient("t").getUser("U1")).resolves.toMatchObject({ name: "Ann" });
  });

  it("falls back to the real name, then the handle, then the id", async () => {
    const client = makeRealSlackClient("t");

    h.web.users.info.mockResolvedValue({ user: { profile: {}, real_name: "Ann B", name: "a.b" } });
    await expect(client.getUser("U1")).resolves.toMatchObject({ name: "Ann B" });

    h.web.users.info.mockResolvedValue({ user: { name: "a.b" } });
    await expect(client.getUser("U1")).resolves.toMatchObject({ name: "a.b" });

    h.web.users.info.mockResolvedValue({});
    await expect(client.getUser("U1")).resolves.toEqual({
      id: "U1",
      name: "U1",
      isAdmin: false,
      isOwner: false,
    });
  });

  it("carries the admin and owner flags", async () => {
    h.web.users.info.mockResolvedValue({ user: { name: "a.b", is_admin: true, is_owner: true } });
    await expect(makeRealSlackClient("t").getUser("U1")).resolves.toMatchObject({
      isAdmin: true,
      isOwner: true,
    });
  });
});
