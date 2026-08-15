import {
  type BlockActionsPayload,
  type HomeDeps,
  type ViewSubmissionPayload,
  handleAppHomeOpened,
  handleBlockActions,
  handleViewSubmission,
} from "./handlers.js";

/**
 * Turns one Socket Mode envelope into a handler call, and returns the body to
 * acknowledge with (`undefined` for a plain ack).
 *
 * `type` is the envelope type, so every interaction arrives as `interactive` and
 * only the payload says whether it was a click or a submitted form. Reading the
 * payload's own `type` is also correct if the envelope ever names it directly,
 * which keeps this independent of the library's envelope naming.
 */
export async function routeSocketEvent(
  deps: HomeDeps,
  type: string,
  payload: unknown,
): Promise<unknown> {
  if (type === "events_api") {
    const event = (payload as { event?: { type?: string; user?: string } }).event;
    if (event?.type === "app_home_opened" && event.user) {
      await handleAppHomeOpened(deps, { user: event.user });
    }
    return undefined;
  }

  const kind = (payload as { type?: string }).type;

  if (kind === "block_actions") {
    await handleBlockActions(deps, payload as BlockActionsPayload);
    return undefined;
  }

  if (kind === "view_submission") {
    return (await handleViewSubmission(deps, payload as ViewSubmissionPayload)) ?? undefined;
  }

  return undefined;
}
