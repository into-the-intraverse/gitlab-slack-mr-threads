# Local setup

## 1. Prerequisites

- Node 20 LTS (`node -v`)
- Bun 1.x (`bun -v`) — optional but recommended
- A Slack workspace you control (or can create an app in)
- A GitLab project you have Maintainer rights on

## 2. Clone and install

~~~
git clone <this-repo>
cd gitlab-slack-plugin
bun install
~~~

## 3. Create the Slack app

1. Go to <https://api.slack.com/apps> and click **Create New App → From scratch**.
2. Name: `MR Threads Bot`. Workspace: `Example Workspace`.
3. In **OAuth & Permissions → Scopes → Bot Token Scopes**, add:
   - `chat:write` — post and update messages
   - `chat:write.public` — post in channels the bot is not a member of (optional; if you prefer inviting the bot, skip this)
   - `users:read` — resolve GitLab usernames to Slack accounts so the author and reviewers get
     real `@`-mentions. Without it the bot still works, but names are posted as plain text and
     nobody is notified. Mentions can also be switched off in the settings panel.
   - `channels:read`, `groups:read` — let the panel check that the bot is actually in a channel
     before saving it
4. Turn on the settings panel (skip if you only want the webhook side):
   - **Socket Mode** → enable, generate an app-level token with `connections:write`. That token
     (`xapp-…`) is your `SLACK_APP_TOKEN`.
   - **Interactivity & Shortcuts** → enable. No request URL is needed under Socket Mode.
   - **App Home** → enable the Home tab, leave the Messages tab off.
   - **Event Subscriptions** → enable, subscribe the bot to `app_home_opened`.
5. Click **Install to Workspace** at the top of the OAuth page. Approve. Reinstall after any scope
   change, otherwise the new scopes are not in effect.
6. Copy the **Bot User OAuth Token** (starts with `xoxb-…`). This is your `SLACK_BOT_TOKEN`.
7. Invite the bot to the target channel: in Slack, `/invite @MR Threads Bot` inside `#mr-reviews`.
   You pick that channel in the panel later, not in `.env`.

## 4. Configure env

Copy `.env.example` to `.env` and fill in values:

~~~
cp .env.example .env
~~~

- `SLACK_BOT_TOKEN` — from step 3.6
- `SLACK_APP_TOKEN` — from step 3.4, or leave empty to run without the panel
- `SLACK_ADMIN_USER_IDS` — your own Slack user ID, so you can change settings without being a
  workspace admin. Slack profile → **⋮** → **Copy member ID** (starts with `U…`).
- `GITLAB_WEBHOOK_SECRET` — any random string, e.g. `openssl rand -hex 32`
- `GITLAB_BASE_URL` — your GitLab host, e.g. `https://gitlab.example.com`
- `DATABASE_URL` — leave default `file:./data/app.db`

There is no channel, project or Jira setting in `.env` — those live in the panel.

## 5. Run locally

~~~
bun run migrate        # apply schema
bun run dev            # start server on :8080 with hot reload
~~~

Health check:

~~~
curl -sS http://127.0.0.1:8080/healthz
# {"ok":true,"inbox_pending":0,"inbox_failed":0,"oldest_pending_age_ms":0,"slack_socket_connected":true}
~~~

`slack_socket_connected` is `null` when `SLACK_APP_TOKEN` is unset.

## 5a. Pick a default channel

The bot boots **unconfigured**: it accepts webhooks and holds them, but posts nothing until it has a
default channel. Open the bot in Slack, switch to the **Home** tab, and pick one. Anything already
held in the inbox is delivered on the next tick.

Without `SLACK_APP_TOKEN` there is no panel, and the only way to set this is to write the row by
hand:

~~~
sqlite3 ./data/app.db "INSERT INTO settings (key, value, updated_at)
  VALUES ('default_channel_id', '\"C0123456789\"', datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
~~~

`value` is JSON, hence the quotes inside quotes — a bare `C0123456789` is not valid JSON and the
worker falls back to the default.

## 6. Expose your local server to GitLab

Use `ngrok` or similar:

~~~
ngrok http 8080
~~~

Copy the public HTTPS URL, e.g. `https://abc123.ngrok-free.app`.

## 7. Create the GitLab webhook

In GitLab, **Project → Settings → Webhooks → Add new webhook**:

- **URL**: `https://abc123.ngrok-free.app/webhooks/gitlab`
- **Secret token**: paste the same value as `GITLAB_WEBHOOK_SECRET` in `.env`
- **Trigger**: check **Merge request events** only
- **Enable SSL verification**: on (GitLab default)
- Click **Add webhook**

GitLab will immediately send a test ping. It may show as failed if no `merge_request` payload matches — that is fine, the real events will arrive on MR activity.

## 8. Test with sample fixtures

Without creating real MRs, you can replay fixtures:

~~~
GITLAB_WEBHOOK_SECRET=<your-secret> bun x tsx scripts/replay.ts test/fixtures/gitlab/mr_opened.json
~~~

Watch your Slack channel — a new parent message should appear.

Then replay `mr_merged.json` and verify the parent flips to `Merged` and a threaded reply appears.

## 9. Browser simulator (recommended while wiring up Slack)

Set `DEV_SIMULATOR=true` in `.env`, restart (`bun run dev`), and open:

~~~
http://127.0.0.1:8080/dev/simulator
~~~

Paste the same value as `GITLAB_WEBHOOK_SECRET` into the **secret** field, then click scenarios
(`Opened`, `Approval`, `Merged`, …) and watch the Slack channel. Each click builds a real
`Merge Request Hook` payload, sends it to `/webhooks/gitlab`, and logs the HTTP response.

- **new** next to the MR iid starts a brand-new Slack thread — threads are keyed on
  `(project.id, iid)`, so reuse the same iid to keep appending to one thread.
- **▶ Full lifecycle** fires `open → approval → approved → merge` with a pause between events.
- The **Edge cases** row covers wrong secret (401), missing UUID header (400), duplicate delivery
  (`{"duplicate":true}`) and a non-MR payload (accepted, then skipped by the worker).
- The **Payload** box is editable — tweak the JSON and hit *Send this payload* for anything the
  buttons do not cover.
- The header shows live `/healthz` counters, so a stuck `pending` or a rising `failed` is visible
  without tailing logs.

Keep `DEV_SIMULATOR` off in production: the route is simply not registered when it is unset.

## 10. Troubleshooting

- **401 from `/webhooks/gitlab`** → `X-Gitlab-Token` mismatch. Check `.env` vs GitLab webhook config.
- **200 but no Slack post, `inbox_pending` climbing** → no default channel yet. Pick one on the Home
  tab. Nothing is lost; the queue drains once it is set.
- **200 but no Slack post, `inbox_pending` at 0** → the project is switched off in the panel, or the
  token is not a bot token. Check the logs.
- **No events arrive at all** → `ngrok` URL changed on restart; re-paste into GitLab.
- **The Home tab is empty** → the app has no Home tab enabled, or `app_home_opened` is not
  subscribed. Both are in step 3.4. Reinstall the app after changing either.
- **The Home tab shows no buttons** → you are not a workspace admin and your user ID is not in
  `SLACK_ADMIN_USER_IDS`.
- **`slack_socket_connected` is `false`** → `SLACK_APP_TOKEN` is wrong or Socket Mode is off. The
  webhook side keeps working regardless; only the panel is affected.
