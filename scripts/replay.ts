import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const fixturePath = process.argv[2];
if (!fixturePath) {
  console.error("usage: bun x tsx scripts/replay.ts <fixture.json>");
  process.exit(1);
}

const url = process.env.REPLAY_URL ?? "http://127.0.0.1:8080/webhooks/gitlab";
const secret = process.env.GITLAB_WEBHOOK_SECRET;
if (!secret) {
  console.error("GITLAB_WEBHOOK_SECRET must be set");
  process.exit(1);
}

const payload = readFileSync(fixturePath, "utf8");

const res = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-gitlab-token": secret,
    "x-gitlab-event": "Merge Request Hook",
    "x-gitlab-webhook-uuid": randomUUID(),
    "x-gitlab-event-uuid": randomUUID(),
  },
  body: payload,
});

const body = await res.text();
console.log(`HTTP ${res.status}  ${body}`);
if (!res.ok) process.exit(1);
