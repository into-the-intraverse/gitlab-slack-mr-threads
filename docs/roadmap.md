# Roadmap

Ideas, not commitments. Most come from a look at similar tools in September 2026 (sources at
the end). Ordered by how well they fit the current design: a webhook-driven worker that keeps
one live parent message per MR.

## Next

- **Pipeline status on the parent.** Running / passed / failed next to the MR status. PRFlow,
  MergeMe and Axolo all show it; it is the most visible gap. Needs a second webhook kind:
  `src/gitlab/types.ts` accepts only `merge_request` today. Pipeline events are frequent, so the
  parent is updated more often — `chat.update` does not re-notify, so this costs Slack API calls,
  not channel noise.
- **Merge conflict flag.** Shown by PRFlow, Axolo and GitLoom. Check whether the MR payload
  already carries it (`detailed_merge_status`?) before reaching for anything else.
- **"What's left to merge".** Approvals as `2/3` and the number of unresolved threads, instead
  of only the moment all threads become resolved. The required approval count may not be in the
  webhook payload at all — check before designing.
- **GitLab comments in the thread.** Review comments posted as thread replies; an edited comment
  updates its reply in place. The core feature of PRFlow and MergeMe, and also Homer. Needs the
  `note` webhook kind.
- **Reopened MRs.** `reopen` currently keeps the previous status and posts no reply
  (`src/state/derive.ts`, `src/slack/reply.ts`).

## Later

- **Scheduled digest per channel.** Grouped as needs attention / waiting for review / ready to
  merge, with stale MRs called out. PRFlow, MergeMe, Axolo, GitLoom. This would be the first
  time-driven component — everything today reacts to an event — and it has to be built from what
  the bot has stored, because the bot does not call the GitLab API.
- **Stale-MR reminders by DM** to the reviewers who are holding it up. Toast, Axolo,
  PullNotifier. Same timer as the digest.
- **Routing by label.** A label on the MR overrides the project's channel (MergeMe).
  PullNotifier also routes by author, reviewer and file path.
- **Filters.** Ignore MRs opened by bots (Renovate, Dependabot); optionally skip drafts until
  they are marked ready (mergeminion's `EXCLUDE_DRAFT`).
- **Quiet hours.** Hold mentions outside working hours (Axolo).

## Needs a GitLab API token

The bot holds only the webhook secret today. Each item below adds a token with write access —
a new secret and a new failure mode — so they are worth doing together or not at all.

- **Reply in Slack → comment in GitLab.** Two-way thread sync (PullFlow, Axolo).
- **Auto-assign reviewers from `CODEOWNERS`** (Axolo).
- **Slash commands.** Share an MR into a channel, changelog between two tags (Homer).

## Not planned

- **Review metrics** (time to first review, time to merge, reviewer load). PRFlow and Toast
  have them; it is a separate product, not a feature of this one.
- **Multiple Slack workspaces.**
- **Coloured status bar** (PRFlow's red / green / purple). Rejected on purpose: the only colour
  channel is the legacy attachment bar. See "Slack constraints" in `CLAUDE.md`.

## Sources

- [PRFlow](https://prflow.dev/) and its [GitLab comparison](https://prflow.dev/blog/best-gitlab-slack-integration/)
- [MergeMe](https://mergeme.dev/integrations/gitlab-slack)
- [mergeminion](https://github.com/elninotech/mergeminion), [Homer](https://github.com/fabienfleureau/homer) — open source
- [Axolo](https://axolo.co/gitlab-slack-integration)
- [GitLoom comparison](https://gitloom.ai/compare/best-github-slack-integrations)
- [PullNotifier](https://blog.pullnotifier.com/blog/best-github-slack-integrations), [Toast](https://toast.ninja/), [PullFlow](https://slack.com/marketplace/A024J19TG6A-pullflow)
