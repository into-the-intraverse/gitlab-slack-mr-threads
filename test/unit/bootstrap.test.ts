import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// bootstrap() is wiring, so every collaborator is a stub and what is asserted is
// the wiring itself: what is built, in which order, and what shutdown tears down.
const h = vi.hoisted(() => {
  const calls: string[] = [];
  const track = <T>(name: string, value?: T) => {
    calls.push(name);
    return value as T;
  };

  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const db = { destroy: vi.fn(async () => track("db.destroy")) };
  const settings = { read: vi.fn(async () => ({ user_map: { "a.b": "U1" } })) };
  const directory = {
    refresh: vi.fn(async () => track("directory.refresh")),
    start: vi.fn(() => track("directory.start")),
    stop: vi.fn(() => track("directory.stop")),
    mention: vi.fn(),
    setOverrides: vi.fn(),
  };
  const worker = {
    processOnce: vi.fn(),
    start: vi.fn(() => track("worker.start")),
    stop: vi.fn(async () => track("worker.stop")),
  };
  const app = {
    listen: vi.fn(async () => track("app.listen")),
    close: vi.fn(async () => track("app.close")),
  };
  const socket = {
    start: vi.fn(async () => track("socket.start")),
    stop: vi.fn(async () => track("socket.stop")),
    connected: vi.fn(() => true),
  };
  const slackClient = { name: "slack-client" };
  const authz = { canEditSettings: vi.fn(async () => true) };

  const cfg: Record<string, unknown> = {};
  const spies = {
    loadConfig: vi.fn(() => cfg),
    makeLogger: vi.fn(() => log),
    openDb: vi.fn(() => ({ db, raw: {} })),
    migrateToLatest: vi.fn(async () => track("migrate")),
    makeSettingsStore: vi.fn(() => settings),
    makeRealSlackClient: vi.fn(() => slackClient),
    makeSlackDirectory: vi.fn(() => directory),
    makeWorker: vi.fn(() => worker),
    makeAuthz: vi.fn(() => authz),
    makeSlackSocket: vi.fn(() => socket),
    buildApp: vi.fn(() => app),
    routeSocketEvent: vi.fn(async () => "routed"),
  };

  return {
    calls,
    log,
    db,
    settings,
    directory,
    worker,
    app,
    socket,
    slackClient,
    authz,
    cfg,
    spies,
  };
});

vi.mock("../../src/config.js", () => ({ loadConfig: h.spies.loadConfig }));
vi.mock("../../src/logger.js", () => ({ makeLogger: h.spies.makeLogger }));
vi.mock("../../src/db/index.js", () => ({ openDb: h.spies.openDb }));
vi.mock("../../src/db/migrate.js", () => ({ migrateToLatest: h.spies.migrateToLatest }));
vi.mock("../../src/settings/store.js", () => ({ makeSettingsStore: h.spies.makeSettingsStore }));
vi.mock("../../src/slack/client.js", () => ({ makeRealSlackClient: h.spies.makeRealSlackClient }));
vi.mock("../../src/slack/directory.js", () => ({ makeSlackDirectory: h.spies.makeSlackDirectory }));
vi.mock("../../src/worker/worker.js", () => ({ makeWorker: h.spies.makeWorker }));
vi.mock("../../src/slack/authz.js", () => ({ makeAuthz: h.spies.makeAuthz }));
vi.mock("../../src/slack/socket.js", () => ({ makeSlackSocket: h.spies.makeSlackSocket }));
vi.mock("../../src/server/app.js", () => ({ buildApp: h.spies.buildApp }));
vi.mock("../../src/slack/home/route.js", () => ({ routeSocketEvent: h.spies.routeSocketEvent }));

import { bootstrap } from "../../src/bootstrap.js";

const BASE_CFG = {
  slackBotToken: "xoxb-1",
  gitlabWebhookSecret: "s3cr3t",
  gitlabBaseUrl: "https://gitlab.example.com",
  databaseUrl: "file:/tmp/app.db",
  port: 8080,
  logLevel: "info",
  workerPollMs: 500,
  slackDirectoryRefreshMs: 900_000,
  slackAdminUserIds: ["U-ADMIN"],
  slackAppToken: "xapp-1",
  slackApiUrl: null,
  devSimulator: false,
};

const signalHandlers = new Map<string, (...args: unknown[]) => void>();
let exitSpy: ReturnType<typeof vi.spyOn>;

const buildAppOptions = () =>
  h.spies.buildApp.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined;

beforeEach(() => {
  h.calls.length = 0;
  signalHandlers.clear();
  for (const spy of Object.values(h.spies)) spy.mockClear();
  h.directory.stop.mockClear();
  h.worker.stop.mockClear();
  h.app.close.mockClear();
  h.socket.stop.mockClear();
  h.db.destroy.mockClear();
  h.log.warn.mockClear();
  for (const [k, v] of Object.entries(BASE_CFG)) h.cfg[k] = v;

  exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  // Only the two signals bootstrap registers are intercepted; vitest keeps its own.
  const realOn = process.on.bind(process);
  vi.spyOn(process, "on").mockImplementation(((event: string, fn: (...a: unknown[]) => void) => {
    if (event === "SIGTERM" || event === "SIGINT") {
      signalHandlers.set(event, fn);
      return process;
    }
    return realOn(event as never, fn);
  }) as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("bootstrap with a Socket Mode token", () => {
  it("migrates before it starts serving, and warms the directory before the worker", async () => {
    await bootstrap();

    expect(h.calls).toEqual([
      "migrate",
      "directory.refresh",
      "directory.start",
      "worker.start",
      "socket.start",
      "app.listen",
    ]);
  });

  it("passes config through to the pieces that need it", async () => {
    await bootstrap();

    expect(h.spies.openDb).toHaveBeenCalledWith("file:/tmp/app.db");
    expect(h.spies.makeRealSlackClient).toHaveBeenCalledWith("xoxb-1", null);
    expect(h.directory.start).toHaveBeenCalledWith(900_000);
    expect(h.worker.start).toHaveBeenCalledWith(500);
    expect(h.app.listen).toHaveBeenCalledWith({ host: "0.0.0.0", port: 8080 });
    expect(buildAppOptions()).toMatchObject({ gitlabWebhookSecret: "s3cr3t", devSimulator: false });
  });

  it("migrates the database it opened, with the migrations it ships", async () => {
    await bootstrap();

    // No folder argument: the list is static, so there is no path to get wrong.
    expect(h.spies.migrateToLatest).toHaveBeenCalledWith(h.db);
  });

  it("seeds the directory with the saved user overrides", async () => {
    await bootstrap();
    expect(h.spies.makeSlackDirectory.mock.calls[0]?.[0]).toMatchObject({
      overrides: { "a.b": "U1" },
    });
  });

  // The Web API client retries a dead Slack for about half an hour. Waiting that
  // out before listening would hand every delivery back to GitLab's retries.
  it("opens the port even if Slack never answers", async () => {
    h.directory.refresh.mockImplementationOnce(() => new Promise<void>(() => {}));
    vi.useFakeTimers();

    const booting = bootstrap();
    await vi.advanceTimersByTimeAsync(5_000);
    await booting;

    expect(h.app.listen).toHaveBeenCalledWith({ host: "0.0.0.0", port: 8080 });
    expect(h.worker.start).toHaveBeenCalled();
  });

  it("reports the socket's own state through the health endpoint", async () => {
    await bootstrap();
    const socketConnected = buildAppOptions()?.socketConnected as () => boolean;

    h.socket.connected.mockReturnValue(false);
    expect(socketConnected()).toBe(false);

    h.socket.connected.mockReturnValue(true);
    expect(socketConnected()).toBe(true);
  });

  it("routes socket envelopes into the settings panel", async () => {
    await bootstrap();
    const { onEvent } = h.spies.makeSlackSocket.mock.calls[0]?.[0] as {
      onEvent: (t: string, p: unknown) => Promise<unknown>;
    };

    await expect(onEvent("interactive", { a: 1 })).resolves.toBe("routed");

    const deps = h.spies.routeSocketEvent.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(deps).toMatchObject({ db: h.db, slack: h.slackClient, directory: h.directory });
    expect((deps.socketConnected as () => boolean)()).toBe(true);
    expect(h.spies.makeAuthz.mock.calls[0]?.[0]).toMatchObject({ adminUserIds: ["U-ADMIN"] });
  });
});

describe("bootstrap without a Socket Mode token", () => {
  beforeEach(() => {
    h.cfg.slackAppToken = null;
  });

  it("still serves webhooks, with the panel off", async () => {
    await bootstrap();

    expect(h.spies.makeSlackSocket).not.toHaveBeenCalled();
    expect(h.calls).toEqual([
      "migrate",
      "directory.refresh",
      "directory.start",
      "worker.start",
      "app.listen",
    ]);
    expect(h.log.warn).toHaveBeenCalledWith(expect.stringContaining("SLACK_APP_TOKEN"));
  });

  it("leaves socketConnected off the app so health does not claim a socket", async () => {
    await bootstrap();
    expect(buildAppOptions()).not.toHaveProperty("socketConnected");
  });
});

describe("the dev simulator", () => {
  it("is announced loudly when it is on", async () => {
    h.cfg.devSimulator = true;
    await bootstrap();

    expect(buildAppOptions()).toMatchObject({ devSimulator: true });
    expect(h.log.warn).toHaveBeenCalledWith(expect.stringContaining("simulator"));
  });

  it("is not mentioned at all when it is off", async () => {
    await bootstrap();

    expect(h.log.warn).not.toHaveBeenCalledWith(expect.stringContaining("simulator"));
  });
});

describe("shutdown", () => {
  const fire = async (signal: string) => {
    signalHandlers.get(signal)?.();
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled());
  };

  it("stops the pollers before it closes the server and the database", async () => {
    await bootstrap();
    h.calls.length = 0;

    await fire("SIGTERM");

    expect(h.calls).toEqual([
      "directory.stop",
      "socket.stop",
      "worker.stop",
      "app.close",
      "db.destroy",
    ]);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("handles SIGINT the same way", async () => {
    await bootstrap();
    h.calls.length = 0;

    await fire("SIGINT");

    expect(h.calls).toContain("db.destroy");
  });

  it("shuts down cleanly when there is no socket to stop", async () => {
    h.cfg.slackAppToken = null;
    await bootstrap();
    h.calls.length = 0;

    await fire("SIGTERM");

    expect(h.calls).toEqual(["directory.stop", "worker.stop", "app.close", "db.destroy"]);
  });
});
