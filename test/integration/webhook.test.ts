import { afterEach, beforeEach, describe, expect, it } from "vitest";
import opened from "../fixtures/gitlab/mr_opened.json";
import { TEST_SECRET, type TestApp, createTestApp } from "../helpers/test-app.js";

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.cleanup();
});

const post = (opts: {
  headers?: Record<string, string>;
  payload?: string | object;
  contentType?: string | null;
}) =>
  t.app.inject({
    method: "POST",
    url: "/webhooks/gitlab",
    headers: {
      "x-gitlab-token": TEST_SECRET,
      "x-gitlab-event": "Merge Request Hook",
      ...(opts.contentType === null
        ? {}
        : { "content-type": opts.contentType ?? "application/json" }),
      ...opts.headers,
    },
    ...(opts.payload === undefined ? {} : { payload: opts.payload }),
  });

describe("the webhook endpoint", () => {
  it("refuses a delivery with no X-Gitlab-Webhook-UUID: there would be no dedup key", async () => {
    const res = await post({ payload: opened });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: expect.stringContaining("Webhook-UUID") });
    expect(await t.db.selectFrom("inbox").selectAll().execute()).toHaveLength(0);
  });

  it("takes a raw text body as the payload", async () => {
    const res = await post({
      headers: { "x-gitlab-webhook-uuid": "wh-text" },
      contentType: "text/plain",
      payload: JSON.stringify(opened),
    });

    expect(res.statusCode).toBe(200);
    const [row] = await t.db.selectFrom("inbox").selectAll().execute();
    // Read back through ParseJSONResultsPlugin, so the column arrives parsed.
    expect(row?.payload_json as unknown).toEqual(opened);
  });

  it("refuses a delivery with no body at all", async () => {
    const res = await post({ headers: { "x-gitlab-webhook-uuid": "wh-empty" }, contentType: null });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid body" });
  });

  // Valid JSON that is not an object: an event is always an object, and storing
  // `null` or `42` would only fail later, in the worker, with no way back.
  it.each([
    ["null", "null"],
    ["a bare number", "42"],
  ])("refuses %s as a body", async (_name, payload) => {
    const res = await post({ headers: { "x-gitlab-webhook-uuid": "wh-odd" }, payload });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid body" });
    expect(await t.db.selectFrom("inbox").selectAll().execute()).toHaveLength(0);
  });

  it("keeps the event uuid GitLab sent alongside the delivery uuid", async () => {
    await t.app.inject({
      method: "POST",
      url: "/webhooks/gitlab",
      headers: {
        "content-type": "application/json",
        "x-gitlab-token": TEST_SECRET,
        "x-gitlab-webhook-uuid": "wh-1",
        "x-gitlab-event-uuid": "ev-1",
      },
      payload: opened,
    });

    const [row] = await t.db.selectFrom("inbox").selectAll().execute();
    expect(row?.event_uuid).toBe("ev-1");
  });

  it("stores a null event uuid when GitLab did not send one", async () => {
    await post({ headers: { "x-gitlab-webhook-uuid": "wh-1" }, payload: opened });

    const [row] = await t.db.selectFrom("inbox").selectAll().execute();
    expect(row?.event_uuid).toBeNull();
  });

  it("reports a duplicate as accepted, so GitLab stops retrying it", async () => {
    const send = () => post({ headers: { "x-gitlab-webhook-uuid": "wh-dup" }, payload: opened });

    await expect(send().then((r) => r.json())).resolves.toEqual({ ok: true, duplicate: false });
    await expect(send().then((r) => r.json())).resolves.toEqual({ ok: true, duplicate: true });
  });

  it("answers 500 when the inbox cannot be written, so GitLab retries", async () => {
    await t.db.destroy();

    const res = await post({ headers: { "x-gitlab-webhook-uuid": "wh-broken" }, payload: opened });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: "persist failed" });
  });
});
