import { z } from "zod";

export const mergeRequestActionSchema = z.enum([
  "open",
  "close",
  "reopen",
  "update",
  "approval",
  "approved",
  "unapproval",
  "unapproved",
  "merge",
]);
export type MergeRequestAction = z.infer<typeof mergeRequestActionSchema>;

const changesFieldSchema = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({ previous: inner.nullable().optional(), current: inner.nullable().optional() });

const gitlabUserSchema = z.object({
  name: z.string(),
  username: z.string(),
});

export const mergeRequestEventSchema = z.object({
  object_kind: z.literal("merge_request"),
  event_type: z.literal("merge_request").optional(),
  // The user who *triggered* the event, not necessarily the MR author. GitLab
  // only exposes the author as a numeric `author_id`, so the author is captured
  // from this field on the `open` event and persisted.
  user: gitlabUserSchema,
  project: z.object({
    id: z.number().int(),
    // Optional because the test fixtures carry only `id`. Real deliveries are
    // expected to include both; the settings panel falls back to `Project <id>`.
    name: z.string().optional(),
    web_url: z.string().url().optional(),
  }),
  object_attributes: z.object({
    iid: z.number().int(),
    title: z.string(),
    description: z.string().nullable().default(""),
    source_branch: z.string(),
    target_branch: z.string(),
    url: z.string().url(),
    state: z.enum(["opened", "closed", "merged", "locked"]),
    action: mergeRequestActionSchema,
    draft: z.boolean().optional().default(false),
    target_project_id: z.number().int().optional(),
  }),
  reviewers: z.array(gitlabUserSchema).optional(),
  changes: z
    .object({
      draft: changesFieldSchema(z.boolean()).optional(),
      // GitLab has no dedicated action for "all threads resolved"; it arrives as
      // action=update carrying this flag.
      blocking_discussions_resolved: changesFieldSchema(z.boolean()).optional(),
      title: changesFieldSchema(z.string()).optional(),
      labels: z.any().optional(),
      description: changesFieldSchema(z.string()).optional(),
    })
    .optional(),
});
export type MergeRequestEvent = z.infer<typeof mergeRequestEventSchema>;
