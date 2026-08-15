import pino from "pino";
import { describe, expect, it } from "vitest";
import { makeAuthz } from "../../src/slack/authz.js";
import { FakeSlackClient } from "../helpers/fake-slack.js";

const log = pino({ level: "silent" });

const authzWith = (adminUserIds: string[], slack = new FakeSlackClient()) => ({
  slack,
  authz: makeAuthz({ slack, log, adminUserIds }),
});

describe("canEditSettings", () => {
  it("allows anyone on the env list without asking Slack", async () => {
    const { slack, authz } = authzWith(["U-OWNER"]);
    slack.getUserError = new Error("should not be called");
    expect(await authz.canEditSettings("U-OWNER")).toBe(true);
  });

  it("allows a workspace admin", async () => {
    const { slack, authz } = authzWith([]);
    slack.usersById.set("U-A", { id: "U-A", name: "Admin", isAdmin: true, isOwner: false });
    expect(await authz.canEditSettings("U-A")).toBe(true);
  });

  it("allows a workspace owner", async () => {
    const { slack, authz } = authzWith([]);
    slack.usersById.set("U-O", { id: "U-O", name: "Owner", isAdmin: false, isOwner: true });
    expect(await authz.canEditSettings("U-O")).toBe(true);
  });

  it("denies a plain member", async () => {
    const { slack, authz } = authzWith([]);
    slack.usersById.set("U-M", { id: "U-M", name: "Member", isAdmin: false, isOwner: false });
    expect(await authz.canEditSettings("U-M")).toBe(false);
  });

  it("denies when the Slack lookup fails", async () => {
    const { slack, authz } = authzWith([]);
    slack.getUserError = new Error("missing_scope");
    expect(await authz.canEditSettings("U-M")).toBe(false);
  });

  it("asks Slack every time rather than caching a stale answer", async () => {
    const { slack, authz } = authzWith([]);
    let calls = 0;
    const original = slack.getUser.bind(slack);
    slack.getUser = async (id: string) => {
      calls++;
      return original(id);
    };
    await authz.canEditSettings("U-M");
    await authz.canEditSettings("U-M");
    expect(calls).toBe(2);
  });
});
