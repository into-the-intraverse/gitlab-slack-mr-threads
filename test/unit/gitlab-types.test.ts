import { describe, expect, it } from "vitest";
import { mergeRequestEventSchema } from "../../src/gitlab/types.js";
import opened from "../fixtures/gitlab/mr_opened.json";

const parse = (over: Record<string, unknown> = {}) =>
  mergeRequestEventSchema.parse({
    ...opened,
    object_attributes: { ...opened.object_attributes, ...over },
  });

describe("the merge request payload contract", () => {
  // GitLab omits `draft` on older versions. Defaulting it the wrong way would
  // open every thread as a draft, which is a state nothing later corrects.
  it("treats a missing draft flag as not a draft", () => {
    const { draft: _dropped, ...attrs } = opened.object_attributes;
    const event = mergeRequestEventSchema.parse({ ...opened, object_attributes: attrs });
    expect(event.object_attributes.draft).toBe(false);
  });

  it("keeps an explicit draft flag", () => {
    expect(parse({ draft: true }).object_attributes.draft).toBe(true);
  });

  it("turns a missing description into an empty one, and keeps an explicit null", () => {
    const { description: _dropped, ...attrs } = opened.object_attributes;
    expect(
      mergeRequestEventSchema.parse({ ...opened, object_attributes: attrs }).object_attributes
        .description,
    ).toBe("");
    expect(parse({ description: null }).object_attributes.description).toBeNull();
  });

  it("refuses an event that is not about a merge request", () => {
    expect(() => mergeRequestEventSchema.parse({ ...opened, object_kind: "push" })).toThrow();
  });

  it("refuses an action GitLab does not document", () => {
    expect(() => parse({ action: "teleport" })).toThrow();
  });
});
