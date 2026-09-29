# CLAUDE.md

Non-obvious facts about this repo. See `README.md` for what the bot does.

## Commands

~~~
bun run dev            # tsx watch --env-file=.env src/index.ts — requires .env to exist
bun run test           # vitest, 378 tests (e2e excluded)
bun run test:coverage  # same run + v8 coverage; fails under 95% on any of the four metrics
bun run test:e2e       # builds, then runs the compiled bot in its own process
bun run test:mutation  # stryker; ~6 minutes, score is ~84%
bun run build          # tsc, must stay clean
bun run migrate        # not usually needed; boot migrates
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

## The coverage gate

A **pre-commit hook runs `bun run test:coverage`** and fails the commit when coverage drops
below the thresholds. It uses git's config-based hooks (git >= 2.54), not `.git/hooks/*`, so the
definition is version-controlled in `.githooks/config` — but a config include is never enabled
automatically, so **each clone has to opt in once**:

~~~
git config --local include.path ../.githooks/config   # path is relative to .git/config
git hook list pre-commit                              # should print: coverage
~~~

`git hook run pre-commit` runs it by hand; `git commit --no-verify` skips it once;
`git config --local hook.coverage.enabled false` turns it off. Nothing here reads
`.git/hooks/`, so a stale sample file in there is not what ran.

## Architecture

`POST /webhooks/gitlab` verifies `X-Gitlab-Token`, writes the raw payload to the `inbox` table
keyed by `X-Gitlab-Webhook-UUID` (that key is the dedup mechanism), and returns 200. A polling
worker claims rows, parses them with zod, derives status, and calls Slack. The HTTP path never
talks to Slack — a Slack outage costs latency, not events.

Thread identity is `(project_id, mr_iid)`. The Jira key is display metadata and never identity:
two MRs can share a ticket.

Settings live in the `settings` and `project_settings` tables, not in env — env keeps only
secrets, `SLACK_ADMIN_USER_IDS`, and the things needed before the database is open (`LOG_LEVEL`,
`WORKER_POLL_MS`, `SLACK_DIRECTORY_REFRESH_MS`, `SLACK_API_URL`). The worker re-reads settings on every event, with
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

Coverage is 100% of lines, statements and functions and ~98.6% of branches, and
`vitest.config.ts` fails the run below 95% on any of them. `src/index.ts` is excluded because
the wiring it used to hold now lives in `src/bootstrap.ts`, which is tested with every
collaborator stubbed (`test/unit/bootstrap.test.ts` asserts boot order and shutdown order);
`src/db/schema.ts` is excluded because it is types only. **The three branch arms still uncovered
are unreachable, not forgotten**: `socket?.connected() ?? false` twice in `bootstrap.ts` and
`res?.numInsertedOrUpdatedRows ?? 0` in `inbox.ts` exist only because TypeScript cannot narrow a
`let` inside a closure, or types the driver result as optional. Deleting them breaks `tsc`;
reaching them needs a state the runtime cannot produce. Don't contort either side to close them.

Three modules are covered through their libraries rather than the network: `slack/client.ts`
mocks `@slack/web-api`, `slack/socket.ts` mocks `@slack/socket-mode`, and `logger.ts` mocks
`pino` — the last one on purpose, because really building the dev logger spawns a pino-pretty
worker thread that outlives the test process.

## Migrations are modules, not files on disk

`src/db/migrations/index.ts` lists every migration as a static import, and `migrateToLatest()`
takes that record (tests inject their own). **Adding a migration means adding a line there** — a
forgotten line fails at once, because the table it creates will not exist.

They live under `src/` rather than at the repo root on purpose: it is what makes them ordinary
modules that `tsc` compiles into `dist` with everything else. The previous arrangement scanned a
directory and `import()`ed whatever it found, which behaves differently under vitest, under `tsx`
and under plain node — and shipped a build that could not boot at all (`.ts` migrations copied
next to `dist`, `ERR_UNKNOWN_FILE_EXTENSION` on the first one) while 376 tests, 100% line
coverage and a mutation run stayed green. Node ≥ 22.6 strips types, so it also booted fine on a
modern dev machine and failed only on the `node:20` image.

**Nothing is read from disk at runtime any more except `public/simulator.html`.** Keep it that
way; if something has to be, check it against `dist/`, not just against `src/`.

## The end-to-end test

`test/e2e/boot.test.ts` spawns the compiled `dist/index.js` with `--no-experimental-strip-types`
(so it behaves like the image's node:20), points `SLACK_API_URL` at a fake Slack HTTP server, and
drives one MR through a real socket. A second case boots it against a Slack that refuses every
connection and asserts the webhook endpoint still answers — `bootstrap.ts` caps the first
directory load at `DIRECTORY_WARMUP_MS`, because the Web API client retries a dead Slack for
about half an hour and GitLab would spend that time getting connection refused.

It is out of the default run because it needs a build, and out of the coverage and mutation
numbers because a separate process is not instrumented — it buys a different kind of confidence,
not a better score. `.github/workflows/ci.yml` additionally builds the image and curls `/healthz`
inside it, which is the same check one level closer to what actually deploys.

## Dev simulator

`DEV_SIMULATOR=true` serves a page at `GET /dev/simulator` that fakes GitLab deliveries against
the running bot. It is served from the app itself on purpose: the `X-Gitlab-*` headers would
otherwise trigger a CORS preflight this server does not answer. Keep it off in production.
