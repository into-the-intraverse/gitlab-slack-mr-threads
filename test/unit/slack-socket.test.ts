import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const listeners = new Map<string, (arg: unknown) => Promise<void> | void>();
  const client = {
    on: vi.fn((event: string, fn: (arg: unknown) => Promise<void> | void) => {
      listeners.set(event, fn);
    }),
    start: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  };
  const options: unknown[] = [];
  return { listeners, client, options };
});

vi.mock("@slack/socket-mode", () => ({
  SocketModeClient: vi.fn(function SocketModeClient(opts: unknown) {
    h.options.push(opts);
    return h.client;
  }),
}));

import { makeSlackSocket } from "../../src/slack/socket.js";

const log = pino({ level: "silent" });

/** Fires an event the library would emit; `slack_event` carries the ack callback. */
const emit = async (event: string, arg?: unknown) => {
  await h.listeners.get(event)?.(arg);
};

beforeEach(() => {
  h.listeners.clear();
  h.options.length = 0;
  h.client.start.mockClear();
  h.client.disconnect.mockClear();
});

describe("connection state", () => {
  it("starts disconnected and follows the library's events", async () => {
    const socket = makeSlackSocket({ appToken: "xapp-1", log, onEvent: async () => undefined });
    expect(socket.connected()).toBe(false);

    await emit("connected");
    expect(socket.connected()).toBe(true);

    await emit("disconnected");
    expect(socket.connected()).toBe(false);
  });

  it("passes the app token to the library", () => {
    makeSlackSocket({ appToken: "xapp-1", log, onEvent: async () => undefined });
    expect(h.options).toEqual([{ appToken: "xapp-1" }]);
  });

  it("reports disconnected after stop()", async () => {
    const socket = makeSlackSocket({ appToken: "xapp-1", log, onEvent: async () => undefined });
    await socket.start();
    await emit("connected");

    await socket.stop();

    expect(h.client.start).toHaveBeenCalledTimes(1);
    expect(h.client.disconnect).toHaveBeenCalledTimes(1);
    expect(socket.connected()).toBe(false);
  });
});

describe("slack_event", () => {
  it("acks with whatever the handler returned", async () => {
    const ack = vi.fn(async () => {});
    makeSlackSocket({
      appToken: "xapp-1",
      log,
      onEvent: async () => ({ response_action: "errors" }),
    });

    await emit("slack_event", { type: "interactive", body: { a: 1 }, ack });

    expect(ack).toHaveBeenCalledWith({ response_action: "errors" });
  });

  it("hands the envelope type and body to the handler", async () => {
    const onEvent = vi.fn(async () => undefined);
    makeSlackSocket({ appToken: "xapp-1", log, onEvent });

    await emit("slack_event", { type: "events_api", body: { a: 1 }, ack: async () => {} });

    expect(onEvent).toHaveBeenCalledWith("events_api", { a: 1 });
  });

  it("acks plainly when the handler has nothing to say", async () => {
    const ack = vi.fn(async () => {});
    makeSlackSocket({ appToken: "xapp-1", log, onEvent: async () => null });

    await emit("slack_event", { type: "events_api", body: {}, ack });

    expect(ack).toHaveBeenCalledWith(undefined);
  });

  it("still acks when the handler throws, so Slack does not retry", async () => {
    const ack = vi.fn(async () => {});
    makeSlackSocket({
      appToken: "xapp-1",
      log,
      onEvent: async () => {
        throw new Error("boom");
      },
    });

    await emit("slack_event", { type: "events_api", body: {}, ack });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledWith();
  });
});
