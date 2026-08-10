import { afterEach, describe, expect, it } from "vitest";
import { type TestApp, createTestApp } from "../helpers/test-app.js";

let t: TestApp;
afterEach(async () => {
  await t.cleanup();
});

describe("dev simulator route", () => {
  it("is not registered unless DEV_SIMULATOR is on", async () => {
    t = await createTestApp();
    const res = await t.app.inject({ method: "GET", url: "/dev/simulator" });
    expect(res.statusCode).toBe(404);
  });

  it("serves the page when enabled", async () => {
    t = await createTestApp({ devSimulator: true });
    const res = await t.app.inject({ method: "GET", url: "/dev/simulator" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("GitLab webhook simulator");
    expect(res.body).toContain("/webhooks/gitlab");
  });
});
