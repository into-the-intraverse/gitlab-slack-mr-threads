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
     nobody is notified. Set `SLACK_MENTIONS=false` to skip the lookup entirely.
4. Click **Install to Workspace** at the top of the same page. Approve.
5. Copy the **Bot User OAuth Token** (starts with `xoxb-…`). This is your `SLACK_BOT_TOKEN`.
6. Invite the bot to the target channel: in Slack, `/invite @MR Threads Bot` inside `#mr-reviews`.
7. Note the channel ID: right-click the channel in Slack → **Copy link** → the last segment is the ID (starts with `C…`). That is `SLACK_DEFAULT_CHANNEL_ID`.

## 4. Configure env

Copy `.env.example` to `.env` and fill in values:

~~~
cp .env.example .env
~~~

- `SLACK_BOT_TOKEN` — from step 3.5
- `SLACK_DEFAULT_CHANNEL_ID` — from step 3.7
- `GITLAB_WEBHOOK_SECRET` — any random string, e.g. `openssl rand -hex 32`
- `GITLAB_BASE_URL` — your GitLab host, e.g. `https://gitlab.example.com`
- `DATABASE_URL` — leave default `file:./data/app.db`

## 5. Run locally

~~~
bun run migrate        # apply schema
bun run dev            # start server on :8080 with hot reload
~~~

Health check:

~~~
curl -sS http://127.0.0.1:8080/healthz
# {"ok":true,"inbox_pending":0,"inbox_failed":0,"oldest_pending_age_ms":0}
~~~

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
- **200 but no Slack post** → check logs. Common causes: `channel_not_found` (bot not invited), token is not a bot token.
- **No events arrive at all** → `ngrok` URL changed on restart; re-paste into GitLab.
