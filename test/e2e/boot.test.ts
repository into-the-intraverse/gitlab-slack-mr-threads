import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import approval from "../fixtures/gitlab/mr_approval.json";
import opened from "../fixtures/gitlab/mr_opened.json";
import { type FakeSlackServer, startFakeSlack } from "./fake-slack-server.js";

/**
 * The only test that runs what actually ships: the compiled `dist/index.js`, in
 * its own process, over a real socket, against the real `@slack/web-api` client.
 *
 * Everything else in the suite loads TypeScript through vitest, which is why the
 * built artefact was able to be broken (migrations shipped as `.ts`, which node
 * cannot import) while the whole suite stayed green.
 */

const ENTRY = resolve(import.meta.dirname, "../../dist/index.js");
const SECRET = "e2e-secret";
const CHANNEL = "C-E2E";

// Node strips TypeScript types from 22.6 onwards, and the runtime image is on
// node:20. Turning it off keeps this test honest about what the container does.
const nodeMajor = Number(process.versions.node.split(".")[0]);
const NODE_ARGS = nodeMajor >= 22 ? ["--no-experimental-strip-types"] : [];

const freePort = async (): Promise<number> =>
  new Promise((res) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => res(port));
    });
  });

const waitFor = async (what: string, check: () => Promise<boolean>, ms = 20_000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
};

let slack: FakeSlackServer;
let child: ChildProcess;
let port: number;
let dbPath: string;
const stderr: string[] = [];

/** Boots the compiled bot with its own database, the way the container does. */
const spawnBot = (env: Record<string, string>, appPort: number): ChildProcess =>
  spawn(process.execPath, [...NODE_ARGS, ENTRY], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      SLACK_BOT_TOKEN: "xoxb-e2e",
      SLACK_APP_TOKEN: "",
      GITLAB_WEBHOOK_SECRET: SECRET,
      GITLAB_BASE_URL: "https://gitlab.example.com",
      PORT: String(appPort),
      WORKER_POLL_MS: "100",
      LOG_LEVEL: "warn",
      DEV_SIMULATOR: "false",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

const freshDbPath = () => join(mkdtempSync(join(tmpdir(), "glsp-e2e-")), "app.db");

const post = (payload: object, webhookUuid: string) =>
  fetch(`http://127.0.0.1:${port}/webhooks/gitlab`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-gitlab-token": SECRET,
      "x-gitlab-event": "Merge Request Hook",
      "x-gitlab-webhook-uuid": webhookUuid,
    },
    body: JSON.stringify(payload),
  });

const health = async () =>
  (await fetch(`http://127.0.0.1:${port}/healthz`)).json() as Promise<Record<string, unknown>>;

beforeAll(async () => {
  if (!existsSync(ENTRY)) throw new Error(`${ENTRY} is missing — run \`bun run build\` first`);

  slack = await startFakeSlack();
  port = await freePort();
  dbPath = freshDbPath();

  child = spawnBot({ SLACK_API_URL: slack.url, DATABASE_URL: `file:${dbPath}` }, port);
  child.stderr?.on("data", (d: Buffer) => stderr.push(d.toString()));
  child.stdout?.on("data", (d: Buffer) => stderr.push(d.toString()));

  await waitFor("the bot to start listening", async () => (await health()).ok === true);

  // Settings live in the database, so configuring the bot means writing to the
  // file the running process is already using — and it must pick that up with
  // no restart, which is the whole promise of the settings panel.
  const db = new Database(dbPath);
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)").run(
    "default_channel_id",
    JSON.stringify(CHANNEL),
    new Date().toISOString(),
  );
  db.close();
}, 60_000);

afterAll(async () => {
  child?.kill();
  await slack?.close();
});

describe("the built artefact", () => {
  it("boots, migrates its own database and serves health", async () => {
    const body = await health();

    expect(body).toMatchObject({ ok: true, inbox_pending: 0, inbox_failed: 0 });
    // No app token was given, so there is no socket to report on.
    expect(body.slack_socket_connected).toBeNull();
    expect(stderr.join("")).not.toMatch(/ERR_UNKNOWN_FILE_EXTENSION|Migration failed/);
  });

  it("takes a webhook over a real socket and posts the thread to Slack", async () => {
    const res = await post(opened, "e2e-1");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, duplicate: false });

    await waitFor("the parent message", async () => slack.of("chat.postMessage").length > 0);

    const [parent] = slack.of("chat.postMessage");
    expect(parent?.authorization).toBe("Bearer xoxb-e2e");
    expect(parent?.args.channel).toBe(CHANNEL);
    expect(parent?.args.text).toContain("[SD-36717]");
    expect(parent?.args.blocks).toContain("👀 Open");
  });

  it("answers a duplicate delivery without posting twice", async () => {
    const res = await post(opened, "e2e-1");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, duplicate: true });
    await new Promise((r) => setTimeout(r, 300));
    expect(slack.of("chat.postMessage")).toHaveLength(1);
  });

  it("updates the parent and replies in the thread on the next event", async () => {
    await post(approval, "e2e-2");

    await waitFor("the thread reply", async () => slack.of("chat.postMessage").length > 1);

    const [update] = slack.of("chat.update");
    expect(update?.args.blocks).toContain("👍 1 approved");

    const reply = slack.of("chat.postMessage")[1];
    expect(reply?.args.thread_ts).toBeTruthy();
    expect(reply?.args.text).toBe("👍 Approved by Example Reviewer");
  });

  it("drains its queue and says so on /healthz", async () => {
    await waitFor("an empty queue", async () => (await health()).inbox_pending === 0);

    expect(await health()).toMatchObject({ inbox_pending: 0, inbox_failed: 0 });
  });
});

describe("a bot whose Slack is unreachable", () => {
  let deadSlackChild: ChildProcess;
  let deadSlackPort: number;

  afterAll(() => deadSlackChild?.kill());

  // The Web API client retries for about half an hour. If the boot waited for it,
  // GitLab would get connection refused and the delivery would ride its retries.
  it("still accepts webhooks, because intake does not depend on Slack", async () => {
    deadSlackPort = await freePort();
    deadSlackChild = spawnBot(
      // Port 1 refuses instantly, so this is the outage, not a slow answer.
      { SLACK_API_URL: "http://127.0.0.1:1/api/", DATABASE_URL: `file:${freshDbPath()}` },
      deadSlackPort,
    );

    await waitFor(
      "the bot to listen without Slack",
      async () =>
        (
          (await (await fetch(`http://127.0.0.1:${deadSlackPort}/healthz`)).json()) as {
            ok: boolean;
          }
        ).ok === true,
      25_000,
    );

    const res = await fetch(`http://127.0.0.1:${deadSlackPort}/webhooks/gitlab`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-gitlab-token": SECRET,
        "x-gitlab-webhook-uuid": "e2e-dead-1",
      },
      body: JSON.stringify(opened),
    });

    // Accepted and durable: the event waits in the inbox for Slack to come back.
    expect(res.status).toBe(200);
  }, 40_000);
});
