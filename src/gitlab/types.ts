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

export const mergeRequestEventSchema = z.object({
  object_kind: z.literal("merge_request"),
  event_type: z.literal("merge_request").optional(),
  user: z.object({
    name: z.string(),
    username: z.string(),
  }),
  project: z.object({
    id: z.number().int(),
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
  changes: z
    .object({
      draft: changesFieldSchema(z.boolean()).optional(),
      title: changesFieldSchema(z.string()).optional(),
      labels: z.any().optional(),
      description: changesFieldSchema(z.string()).optional(),
    })
    .optional(),
});
export type MergeRequestEvent = z.infer<typeof mergeRequestEventSchema>;
