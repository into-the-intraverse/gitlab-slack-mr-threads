# Deployment

## Prod runtime

One container, one volume. No Redis, no external queue.

## Required env vars

See `.env.example` for the complete list. All are injected at runtime; nothing is baked into the image.

- `SLACK_BOT_TOKEN` — production bot token from the Example Workspace workspace
- `SLACK_DEFAULT_CHANNEL_ID` — target channel ID
- `PROJECT_CHANNEL_MAP` (optional) — `12345=C0ABC,67890=C0DEF`
- `ENABLED_PROJECT_IDS` (optional) — allowlist; empty = all projects
- `GITLAB_WEBHOOK_SECRET` — 32+ random bytes
- `GITLAB_BASE_URL` — internal GitLab host
- `DATABASE_URL` — `file:/app/data/app.db`
- `LOG_LEVEL` — `info` or `warn` in prod
- `WORKER_POLL_MS` — `500` default

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
