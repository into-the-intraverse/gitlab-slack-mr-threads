import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KyselyDb } from "../../src/db/index.js";
import { SETTINGS_DEFAULTS, type Settings } from "../../src/settings/schema.js";
import type { SettingsStore } from "../../src/settings/store.js";
import type { SlackDirectory } from "../../src/slack/directory.js";
import { type Worker, makeWorker } from "../../src/worker/worker.js";
import opened from "../fixtures/gitlab/mr_opened.json";
import { FakeSlackClient } from "../helpers/fake-slack.js";
import { type TestApp, createTestApp, postWebhook } from "../helpers/test-app.js";
import { createTestDb } from "../helpers/test-db.js";

const log = pino({ level: "silent" });

const directory: SlackDirectory = {
  mention: (_u, name) => name,
  setOverrides: () => {},
  refresh: async () => {},
  start: () => {},
  stop: () => {},
};

describe("the polling loop", () => {
  let db: KyselyDb;
  let cleanup: () => Promise<void>;
  let worker: Worker;
  let reads: number;
  let settings: SettingsStore;

  /** Holds every settings read — and so every pass — until release() is called. */
  let held: Promise<void> | null;
  let release: () => void;

  const holdPasses = () => {
    held = new Promise<void>((resolve) => {
      release = () => {
        held = null;
        resolve();
      };
    });
  };

  beforeEach(async () => {
    ({ db, cleanup } = await createTestDb());
    reads = 0;
    held = null;
    release = () => {};
    settings = {
      read: async () => {
        reads++;
        if (held) await held;
        // No default channel: processOnce returns without claiming anything, so
        // the loop under test needs neither Slack nor a queue.
        return { ...SETTINGS_DEFAULTS } as Settings;
      },
      write: async () => {},
      jiraKeyRegex: async () => /X-\d+/,
    };
    worker = makeWorker({ db, slack: new FakeSlackClient(), directory, log, settings });
  });

  afterEach(async () => {
    release();
    await worker.stop();
    await cleanup();
  });

  it("keeps polling until it is stopped", async () => {
    worker.start(1);
    await vi.waitFor(() => expect(reads).toBeGreaterThan(1));

    await worker.stop();
    const afterStop = reads;
    await new Promise((r) => setTimeout(r, 30));

    expect(reads).toBe(afterStop);
  });

  it("ignores a second start, so one worker keeps one timer", async () => {
    worker.start(1);
    worker.start(1);
    await vi.waitFor(() => expect(reads).toBeGreaterThan(0));

    await worker.stop();
    const afterStop = reads;
    await new Promise((r) => setTimeout(r, 30));

    expect(reads).toBe(afterStop);
  });

  it("does not start a second pass while one is still running", async () => {
    holdPasses();
    worker.start(1);
    await vi.waitFor(() => expect(reads).toBe(1));

    // Many intervals have fired by now; all of them must have seen `busy`.
    await new Promise((r) => setTimeout(r, 30));
    expect(reads).toBe(1);

    release();
  });

  it("stop() waits for the pass that is already in flight", async () => {
    holdPasses();
    worker.start(1);
    await vi.waitFor(() => expect(reads).toBe(1));

    let stopped = false;
    const stopping = worker.stop().then(() => {
      stopped = true;
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(stopped).toBe(false);

    release();
    await stopping;
    expect(stopped).toBe(true);
  });

  it("survives a pass that throws and keeps polling", async () => {
    const error = vi.spyOn(log, "error");
    let firstCall = true;
    settings.read = async () => {
      reads++;
      if (firstCall) {
        firstCall = false;
        throw new Error("settings table is locked");
      }
      return { ...SETTINGS_DEFAULTS } as Settings;
    };

    worker.start(1);

    await vi.waitFor(() => expect(reads).toBeGreaterThan(1));
    expect(error).toHaveBeenCalledWith(expect.anything(), "worker: tick crashed");
    error.mockRestore();
  });

  it("can be stopped before it was ever started", async () => {
    await expect(worker.stop()).resolves.toBeUndefined();
  });

  it("can be started again after it was stopped", async () => {
    worker.start(1);
    await vi.waitFor(() => expect(reads).toBeGreaterThan(0));
    await worker.stop();
    const afterStop = reads;

    worker.start(1);

    await vi.waitFor(() => expect(reads).toBeGreaterThan(afterStop));
  });
});

// The stub store reports no default channel, which is exactly the state this
// warning describes: events pile up in the inbox and nobody is told twice.
describe("the unconfigured warning", () => {
  let db: KyselyDb;
  let cleanup: () => Promise<void>;
  let worker: Worker;

  beforeEach(async () => {
    ({ db, cleanup } = await createTestDb());
    const settings: SettingsStore = {
      read: async () => ({ ...SETTINGS_DEFAULTS }) as Settings,
      write: async () => {},
      jiraKeyRegex: async () => /X-\d+/,
    };
    worker = makeWorker({ db, slack: new FakeSlackClient(), directory, log, settings });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await cleanup();
  });

  it("is written once a minute, not once an event", async () => {
    const warn = vi.spyOn(log, "warn");
    vi.useFakeTimers();
    const at = (iso: string) => vi.setSystemTime(new Date(iso));

    at("2026-08-15T10:00:00.000Z");
    await worker.processOnce();
    expect(warn).toHaveBeenCalledTimes(1);

    at("2026-08-15T10:00:59.999Z");
    await worker.processOnce();
    expect(warn).toHaveBeenCalledTimes(1);

    // Exactly a minute later is not *more* than a minute later.
    at("2026-08-15T10:01:00.000Z");
    await worker.processOnce();
    expect(warn).toHaveBeenCalledTimes(1);

    at("2026-08-15T10:01:00.001Z");
    await worker.processOnce();
    expect(warn).toHaveBeenCalledTimes(2);

    warn.mockRestore();
  });
});

describe("the poller against a real queue", () => {
  let t: TestApp;
  afterEach(async () => {
    await t.cleanup();
  });

  it("drains everything that is waiting in one pass", async () => {
    t = await createTestApp();
    await postWebhook(t.app, opened, { webhookUuid: "wh-1" });
    await postWebhook(
      t.app,
      { ...opened, object_attributes: { ...opened.object_attributes, iid: 552 } },
      { webhookUuid: "wh-2" },
    );

    // Fake time so that exactly one interval fires: a pass keeps claiming rows
    // until the queue is empty, it does not hand one row per tick to the clock.
    vi.useFakeTimers();
    try {
      t.worker.start(1000);
      await vi.advanceTimersByTimeAsync(1000);

      expect(t.slack.filter("postParent")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
