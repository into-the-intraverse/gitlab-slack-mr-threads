import { afterEach, describe, expect, it, vi } from "vitest";

// pino is mocked so the pretty transport is never really constructed: it would
// spawn a worker thread and keep the test process alive.
const { pinoMock } = vi.hoisted(() => ({ pinoMock: vi.fn(() => ({}) as never) }));
vi.mock("pino", () => ({ pino: pinoMock, default: pinoMock }));

import { makeLogger } from "../../src/logger.js";

const optionsOfLastCall = () => pinoMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  pinoMock.mockClear();
});

describe("makeLogger", () => {
  it("passes the configured level through", () => {
    makeLogger({ logLevel: "debug" });
    expect(optionsOfLastCall().level).toBe("debug");
  });

  it("uses pino-pretty outside production", () => {
    process.env.NODE_ENV = "development";
    makeLogger({ logLevel: "info" });
    expect(optionsOfLastCall().transport).toMatchObject({ target: "pino-pretty" });
  });

  it("logs plain JSON in production", () => {
    process.env.NODE_ENV = "production";
    makeLogger({ logLevel: "info" });
    expect(optionsOfLastCall()).not.toHaveProperty("transport");
  });
});
