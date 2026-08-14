import { z } from "zod";

/**
 * The settings catalogue.
 *
 * Every key here is applied by the worker on the next event, with no restart.
 * Anything that would need a restart belongs in env, not in this catalogue —
 * the panel has no "restart required" affordance and should not gain one.
 */
export const settingsSchema = z.object({
  default_channel_id: z.string().min(1).nullable(),
  mentions_enabled: z.boolean(),
  jira_base_url: z.string().url().nullable(),
  // Capped because it is compiled and run against MR titles and descriptions.
  jira_key_regex: z.string().min(1).max(200),
  user_map: z.record(z.string(), z.string().regex(/^[UW][A-Z0-9]+$/)),
});

export type Settings = z.infer<typeof settingsSchema>;

export const SETTINGS_DEFAULTS: Settings = {
  default_channel_id: null,
  mentions_enabled: true,
  jira_base_url: null,
  jira_key_regex: "[A-Z][A-Z0-9]+-\\d+",
  user_map: {},
};

/** Whoever made a change, as Slack reported them. */
export type Actor = { userId: string; name: string };
