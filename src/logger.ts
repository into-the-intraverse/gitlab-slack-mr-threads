import { pino, type Logger } from "pino";
import type { Config } from "./config.js";

export type { Logger };

export function makeLogger(cfg: Pick<Config, "logLevel">): Logger {
  const isDev = process.env.NODE_ENV !== "production";
  return pino({
    level: cfg.logLevel,
    ...(isDev
      ? {
          transport: {
            target: "pino-pretty",
            options: { translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname" },
          },
        }
      : {}),
  });
}
