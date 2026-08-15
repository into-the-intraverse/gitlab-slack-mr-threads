# CLAUDE.md

Non-obvious facts about this repo. See `README.md` for what the bot does.

## Commands

~~~
bun run dev       # tsx watch --env-file=.env src/index.ts — requires .env to exist
bun run test      # vitest, 115 tests
bun run build     # tsc, must stay clean
bun run migrate   # not usually needed; index.ts migrates on boot
~~~

`tsx` takes its subcommand first: `tsx watch --env-file=.env src/index.ts`. Putting the flag
before `watch` makes tsx treat `watch` as the entry file and fail with `Cannot find module …/watch`.

**`bun run lint` is red on `master`** with pre-existing biome findings in code nobody has touched.
Do not treat a non-zero count as a regression and do not "fix" it in an unrelated change — measure
the delta instead:

~~~
git stash -q -u; bun x biome check <files>; git stash pop -q
~~~

`git checkout -- <file>` reverts to HEAD, not to the state before an experiment. It has already
wiped a session's uncommitted work here — use it only deliberately.

## Architecture

`POST /webhooks/gitlab` verifies `X-Gitlab-Token`, writes the raw payload to the `inbox` table
keyed by `X-Gitlab-Webhook-UUID` (that key is the dedup mechanism), and returns 200. A polling
worker claims rows, parses them with zod, derives status, and calls Slack. The HTTP path never
talks to Slack — a Slack outage costs latency, not events.

Thread identity is `(project_id, mr_iid)`. The Jira key is display metadata and never identity:
two MRs can share a ticket.

Settings live in the `settings` and `project_settings` tables, not in env — env keeps only
secrets, `SLACK_ADMIN_USER_IDS`, and the things needed before the database is open (`LOG_LEVEL`,
`WORKER_POLL_MS`, `SLACK_DIRECTORY_REFRESH_MS`). The worker re-reads settings on every event, with
no cache, so a change in the panel applies to the next event. **Anything added to the panel must
be hot** — the UI has no "restart required" affordance and should not gain one.

Slack reaches the process over Socket Mode, so there is no inbound Slack endpoint and no request
signing. `src/slack/socket.ts` is transport only; every decision lives in `src/slack/home/*`,
which is why the panel is testable without a WebSocket. `slack_event` carries the envelope type as
its own field, not on the body — reading `body.type` gives `event_callback`, not `events_api`.
Interactivity arrives as envelope type `interactive`, so `src/slack/home/route.ts` reads the
payload's own `type` to tell a click from a submitted form.

With no `default_channel_id` the worker returns before claiming an inbox row, so events are held
rather than failed. A disabled project is the opposite: its events are dropped.

## GitLab payload traps

- **`user` is whoever triggered the event, not the MR author.** The payload has no author
  username, only a numeric `author_id`. The author is captured from `user` on `action=open` and
  persisted as `mr_threads.author_username` / `author_name`; every later render reads the stored
  value. Rendering `event.user.name` made the parent show the approver as the author.
- **Reviewer emails are `[REDACTED]`** unless that person set a public email in their GitLab
  profile, so email-based Slack lookup is not viable. Matching is by username.
- **"All threads resolved" has no dedicated action.** It arrives as `action=update` with
  `changes.blocking_discussions_resolved`. Only the `false → true` edge is reliable — opening a
  thread is not a documented webhook trigger.
- `assignee` / `assignee_id` are deprecated; `reviewers[]` and `assignees[]` are the current fields.

## Slack constraints that shape the message

- A `header` block accepts `plain_text` only and will not render a link. There is no text colour
  in Block Kit. The only real colour channel is the legacy attachment bar, deliberately not used.
- Mentions must be `<@U123>`. A literal `@firstname.lastname` is inert text.
- `chat.update` does not re-notify, so a mention added to an existing parent never pings.
- Only three type tiers exist: `context` (small, muted), `section` (body), `header` (large).

## Message design rules

The parent is `context` / `section` / `context`: eyebrow, headline, byline. Hierarchy comes from
**demotion** — the title is the only body-size line, so it reads as the headline without being
enlarged. Keep it that way; adding a second `section` flattens the message.

Status glyphs are self-describing pictographs, not colour-coded circles, and **a thread reply that
moves the MR into a state opens with that state's glyph** (`🔀 Merged into master` → 🔀 in the
parent). Events that change no state — 👍 approval, ↩️ revoked, ⚠️ quorum lost, 🧵 threads
resolved — keep glyphs of their own. Tests read the pairing off `STATUS_EMOJI`, so it cannot drift.

The Jira key appears once, in the eyebrow; a leading key is stripped from the title. Branch names
are monospaced and the target branch is always shown, even when it is the project default.

## Testing

`createTestApp()` in `test/helpers/test-app.ts` wires a temp SQLite file, a `FakeSlackClient` that
records calls, and the worker. Drive it with `postWebhook()` then `drainWorker()`. Fixtures live in
`test/fixtures/gitlab/` and are also replayable by hand via `scripts/replay.ts`.

Rendering changes are easy to make without breaking a test — the byline regroup passed all 107
tests untouched because branch formatting was uncovered. When changing the message, add the
assertion first.

## Dev simulator

`DEV_SIMULATOR=true` serves a page at `GET /dev/simulator` that fakes GitLab deliveries against
the running bot. It is served from the app itself on purpose: the `X-Gitlab-*` headers would
otherwise trigger a CORS preflight this server does not answer. Keep it off in production.
