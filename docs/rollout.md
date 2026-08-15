# Rollout plan

Which projects are on and where they post is decided in the settings panel (the bot's Home tab in
Slack), not in env. A project appears on that page by itself the first time it sends an event.
Creating its webhook is therefore the act that onboards it — there is no list to edit.

## Phase 1 — Shadow (one project, one channel)

1. Deploy the service. Invite the bot to `#mr-reviews`, open its Home tab and pick that channel as
   the default. Until you do, incoming events are held in the inbox and nothing is posted.
2. Create the GitLab webhook on the test project only (Merge request events).
3. Leave native GitLab-for-Slack notifications **on** in all other channels.
4. Leave them **off** in the target channel `#mr-reviews` to avoid double-posts.
5. Exercise the lifecycle on a throwaway MR: open → draft → approve → merge. Verify the Slack thread tracks state correctly.

## Phase 2 — Production project

1. Confirm Phase 1 was stable for ≥24 h.
2. Create the GitLab webhook on the production project. It registers itself on its first event and
   posts to the default channel.
3. If the project currently routes to `#mr-reviews` via native integration, **turn off** the native GitLab-for-Slack MR events for that project in that channel.

## Phase 3 — Expansion

For each additional project:

- Create the webhook. Nothing else is required to onboard it.
- (If it needs a channel of its own) invite the bot there, then set the channel on the project's row
  in the panel. The panel refuses a channel the bot is not in, so invite first.

To take a project back out without touching GitLab, switch it off in the panel: its events are then
dropped rather than held.

## Rollback

If the service misbehaves:

1. **Instantly**: disable the GitLab webhooks for the affected projects (GitLab → Project → Settings → Webhooks → Edit → uncheck "Enable"). The service keeps running harmlessly.
2. Re-enable the native GitLab-for-Slack MR event notifications in the affected channel.
3. Existing `mr_threads` rows remain — if the service is re-enabled later, threads resume correctly.

## Disabling native GitLab-for-Slack per-channel

Native integration in GitLab is per-project + per-event. To disable MR events in one channel without affecting other channels or other event types:

- **GitLab**: Project → Settings → Integrations → Slack notifications → uncheck **Merge Request** → Save.
- Or at the Slack side: Slack app settings for `GitLab` → channel configuration → remove the MR event subscription for that channel.

The second approach is reversible without touching GitLab settings and is preferable during early rollout.

## Observability during rollout

Watch:

- Logs for `worker: processing failed` lines — these indicate Slack API errors or payload mismatches.
- `/healthz.inbox_failed` — must stay at 0 during rollout.
- Manual eyeballing in `#mr-reviews` for duplicate top-level posts — an instant signal of double-integration.
