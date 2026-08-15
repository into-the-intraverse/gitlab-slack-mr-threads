# Deployment

## Prod runtime

One container, one volume. No Redis, no external queue.

## Required env vars

See `.env.example` for the complete list. All are injected at runtime; nothing is baked into the image.

Env holds secrets, the deployment shape, and the few values that are needed before the database is
open. Routing, mentions and Jira are **not** here — they live in the database and are edited from
the settings panel described below.

- `SLACK_BOT_TOKEN` — production bot token from the Example Workspace workspace
- `SLACK_APP_TOKEN` (optional) — app-level token (`xapp-…`) with `connections:write`. Empty runs the
  bot without the settings panel.
- `SLACK_ADMIN_USER_IDS` (optional) — Slack user IDs allowed to change settings, on top of workspace
  admins and owners
- `GITLAB_WEBHOOK_SECRET` — 32+ random bytes
- `GITLAB_BASE_URL` — internal GitLab host
- `DATABASE_URL` — `file:/app/data/app.db`
- `LOG_LEVEL` — `info` or `warn` in prod
- `WORKER_POLL_MS` — `500` default
- `SLACK_DIRECTORY_REFRESH_MS` — `900000` default

## Settings panel

Settings live in the `settings` and `project_settings` tables and are edited from the bot's **Home**
tab in Slack. Slack reaches the process over Socket Mode — an outbound WebSocket — so there is no
inbound Slack endpoint to expose and nothing extra to put behind TLS.

To turn the panel on, in <https://api.slack.com/apps> → your app:

1. Enable Socket Mode; generate an app-level token with `connections:write` → `SLACK_APP_TOKEN`.
2. Enable Interactivity & Shortcuts. No request URL is needed under Socket Mode.
3. Enable the App Home tab. Leave the Messages tab off.
4. Enable Event Subscriptions; subscribe the bot to `app_home_opened`.
5. Bot token scopes: `chat:write`, `users:read`, `channels:read`, `groups:read`.
6. Reinstall the app so the new scopes take effect.
7. Set `SLACK_ADMIN_USER_IDS` to the Slack IDs of whoever runs the bot.

### First run

A fresh instance starts **unconfigured**: it has no default channel, so it accepts webhooks and
holds them in the inbox without posting anything. Nothing is lost while it waits.

1. Invite the bot to the target channel: `/invite @MR Threads Bot`.
2. Open the bot in Slack and switch to the **Home** tab.
3. Pick a default channel. Everything held in the inbox is delivered on the next worker tick.

Projects appear on the page by themselves, the first time each one sends an event. From there each
project can get a channel of its own or be switched off.

Who may change settings: workspace admins and owners, plus anyone listed in `SLACK_ADMIN_USER_IDS`.
Everyone else sees the same page without controls. `SLACK_ADMIN_USER_IDS` is deliberately env-only —
if the panel could edit it, one admin could grant permanent access to anyone.

Changes apply to the next event. There is no restart-required setting in the panel and there should
not be one.

## TLS

GitLab's `X-Gitlab-Token` is a plaintext shared secret. Running this service behind plain HTTP is a credential leak. Terminate TLS at an upstream proxy (Caddy, nginx, Traefik, cloud load balancer).

## docker-compose (single-host)

~~~
docker compose pull
docker compose up -d
docker compose logs -f app
~~~

The `app_data` named volume persists `/app/data/app.db` across restarts.

## Kubernetes (sketch)

If deploying on k8s:

- **Deployment**: `replicas: 1` (single-instance by design).
- **PersistentVolumeClaim**: mount at `/app/data`.
- **ConfigMap** or **Secret**: env vars.
- **Service** + **Ingress**: expose :8080. Terminate TLS at the ingress.
- **livenessProbe**: `httpGet /healthz` on :8080, `failureThreshold: 3`.

Scaling to >1 replica will corrupt the inbox — do not do it without first moving to Postgres and adding a `FOR UPDATE SKIP LOCKED`-style claim.

## Restart and recovery

- On SIGTERM, the server stops accepting new webhooks, drains in-flight requests, stops the worker, and closes the DB.
- On boot, `migrateToLatest` runs idempotently.
- Any `inbox` rows with `processed_at = NULL` are picked up by the first worker tick.
- With no default channel set, the worker returns before claiming anything, so events accumulate in
  the inbox untouched and drain by themselves once a channel is picked in the panel.
- A channel the bot is not in can no longer be saved: the panel checks membership before writing and
  refuses with a message naming the channel. The recovery below is only for rows that already failed
  under an earlier configuration.
- If an inbox row has hit 10 attempts it is parked (`error` set). Inspect with:

  ~~~
  docker compose exec app sqlite3 /app/data/app.db "SELECT webhook_uuid, error, attempts FROM inbox WHERE attempts >= 10"
  ~~~

  To retry after fixing the root cause:

  ~~~
  docker compose exec app sqlite3 /app/data/app.db "UPDATE inbox SET attempts = 0, error = NULL WHERE webhook_uuid = '<uuid>'"
  ~~~

## Backups

The SQLite file is small (≪1 GB expected). Back up the `/app/data/app.db` file nightly — a simple cron running `sqlite3 /app/data/app.db ".backup /app/data/backup.db"` into an object store is enough.

## Monitoring

- Scrape `/healthz` from your metrics stack.
- Alert thresholds:
  - `inbox_pending > 50` for 5 min → worker falling behind
  - `inbox_failed > 0` → action required
  - `oldest_pending_age_ms > 60000` → worker stuck

`slack_socket_connected` reports the settings panel's WebSocket (`null` when no `SLACK_APP_TOKEN` is
set). It is reported but deliberately does not affect `ok`: a Slack outage costs the panel, not
webhook intake, and taking the container out of rotation would start losing events. Alert on it
separately if you want to know the panel is down.
