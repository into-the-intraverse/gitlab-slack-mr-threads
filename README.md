# GitLab → Slack MR Threads

One merge request = one Slack thread. Parent message stays live with current status; lifecycle events post as threaded replies.

## What it does

- Receives GitLab MR webhooks.
- Creates a Slack parent message on MR open.
- Updates the parent's status header on every state change (draft, approved, merged, closed).
- Posts a short threaded reply for each event.
- One durable `(project_id, mr_iid) → slack_thread_ts` mapping per MR.
- Safe against duplicate webhook deliveries.
- Safe across restarts.

## What it does not do (yet)

- "All discussions resolved" detection
- Reopened MRs
- MR comments mirrored into the thread
- Slack → GitLab 2-way sync
- Multiple Slack workspaces

## Quick start (local)

See `docs/local-setup.md`.

## Deployment

See `docs/deployment.md`.

## Configuration

All config via env vars. See `.env.example` and `docs/deployment.md`.

## Running tests

~~~
bun install
bun test
~~~

All tests run in-process against a temp SQLite file and a fake Slack client. No external dependencies at test time.

## Architecture at a glance

- **Receiver** (Fastify `POST /webhooks/gitlab`): verifies `X-Gitlab-Token`, writes the raw payload to a durable SQLite `inbox` table keyed by `X-Gitlab-Webhook-UUID`, returns 200 in under 50 ms.
- **Worker** (in-process tick loop): claims the oldest unprocessed inbox row, derives the MR's new status, mutates the `mr_threads` row, calls Slack.
- **SQLite** as queue + store. Single-process by design.

## Known limitations

- **Single instance only.** Running >1 replica will double-process inbox rows. If you need HA, migrate to Postgres and add `SELECT … FOR UPDATE SKIP LOCKED` to the worker's claim query.
- **GitLab's `X-Gitlab-Token` is a plaintext shared secret.** Always run behind TLS.
- **No retries for `channel_not_found`.** If the bot isn't in a channel, the MR is marked failed. Invite the bot and manually reset the failed inbox row (see `docs/deployment.md`).

## License

Internal — Example Workspace.
