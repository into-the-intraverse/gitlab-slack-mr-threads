import { afterEach, describe, expect, it, vi } from "vitest";
import { type TestApp, createTestApp } from "../helpers/test-app.js";

// The page is read from disk per request, so "the file is not there" is a real
// state — a container built without `public/`, for instance.
const h = vi.hoisted(() => ({ pageMissing: false }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: actual,
    readFileSync: (path: string, ...rest: unknown[]) => {
      if (h.pageMissing && String(path).includes("simulator.html")) {
        throw new Error("ENOENT: no such file or directory");
      }
      return (actual.readFileSync as (...a: unknown[]) => unknown)(path, ...rest);
    },
  };
});

let t: TestApp;
afterEach(async () => {
  h.pageMissing = false;
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

  it("is never cached, so an edit shows up on reload", async () => {
    t = await createTestApp({ devSimulator: true });
    const res = await t.app.inject({ method: "GET", url: "/dev/simulator" });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("explains itself when the page file is missing", async () => {
    t = await createTestApp({ devSimulator: true });
    h.pageMissing = true;

    const res = await t.app.inject({ method: "GET", url: "/dev/simulator" });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toContain("simulator page not found");
  });
});
