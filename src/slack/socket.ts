import { SocketModeClient } from "@slack/socket-mode";
import type { Logger } from "../logger.js";

export type SlackSocket = {
  start(): Promise<void>;
  stop(): Promise<void>;
  connected(): boolean;
};

export type SlackSocketDeps = {
  /** App-level token (`xapp-…`) with `connections:write`. */
  appToken: string;
  log: Logger;
  /**
   * Returns the body to acknowledge with, or undefined for a plain ack. All
   * decisions live in the caller; this module only moves bytes.
   *
   * `type` is the Socket Mode envelope type (`events_api`, `interactive`, …),
   * not the payload's own `type` field.
   */
  onEvent: (type: string, payload: unknown) => Promise<unknown>;
};

/** What `@slack/socket-mode` emits on `slack_event`. */
type SlackEventArgs = {
  type: string;
  body: unknown;
  ack: (response?: unknown) => Promise<void>;
};

export function makeSlackSocket(deps: SlackSocketDeps): SlackSocket {
  const client = new SocketModeClient({ appToken: deps.appToken });
  let isConnected = false;

  client.on("connected", () => {
    isConnected = true;
    deps.log.info("slack socket connected");
  });
  client.on("disconnected", () => {
    isConnected = false;
    deps.log.warn("slack socket disconnected; the library will reconnect");
  });

  const handle = async ({ type, body, ack }: SlackEventArgs) => {
    try {
      const response = await deps.onEvent(type, body);
      await ack(response ?? undefined);
    } catch (err) {
      // Always acknowledge: an unacknowledged envelope is retried by Slack, and
      // a handler that failed once will fail the same way again.
      deps.log.error({ err, type }, "slack socket: handler failed");
      await ack();
    }
  };

  client.on("slack_event", handle);

  return {
    async start() {
      await client.start();
    },
    async stop() {
      await client.disconnect();
      isConnected = false;
    },
    connected() {
      return isConnected;
    },
  };
}
