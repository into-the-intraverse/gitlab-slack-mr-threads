import { describe, expect, it } from "vitest";
import { FakeSlackClient } from "../helpers/fake-slack.js";

describe("FakeSlackClient panel surface", () => {
  it("records the last published home per user", async () => {
    const slack = new FakeSlackClient();
    await slack.publishHome({ userId: "U1", view: { type: "home", blocks: [] } });
    await slack.publishHome({ userId: "U1", view: { type: "home", blocks: ["second"] } });
    expect(slack.publishedHome.get("U1")).toEqual({ type: "home", blocks: ["second"] });
  });

  it("records opened modals", async () => {
    const slack = new FakeSlackClient();
    await slack.openModal({ triggerId: "T1", view: { callback_id: "project_modal" } });
    expect(slack.openedModals).toEqual([
      { triggerId: "T1", view: { callback_id: "project_modal" } },
    ]);
  });

  it("reports channel membership from its seeded map", async () => {
    const slack = new FakeSlackClient();
    slack.channels.set("C1", { id: "C1", name: "backend-mr", isMember: true });
    expect(await slack.getChannel("C1")).toMatchObject({ isMember: true });
  });

  it("treats an unseeded channel as one the bot is not in", async () => {
    const slack = new FakeSlackClient();
    expect(await slack.getChannel("C-UNKNOWN")).toMatchObject({ isMember: false });
  });

  it("throws when told to, so fail-closed paths can be tested", async () => {
    const slack = new FakeSlackClient();
    slack.getUserError = new Error("missing_scope");
    await expect(slack.getUser("U1")).rejects.toThrow("missing_scope");
  });
});
