import { describe, expect, it } from "vitest";
import type { ProjectSettings } from "../../src/settings/projects.js";
import { isProjectEnabled, resolveChannel } from "../../src/settings/routing.js";

const project = (over: Partial<ProjectSettings> = {}): ProjectSettings => ({
  project_id: 12345,
  name: "api-gateway",
  web_url: "https://gitlab.example.com/team/api-gateway",
  channel_id: null,
  enabled: true,
  last_seen_at: "2026-08-14T10:00:00.000Z",
  ...over,
});

describe("resolveChannel", () => {
  it("uses the project's own channel when it has one", () => {
    expect(resolveChannel(project({ channel_id: "C-OWN" }), "C-DEFAULT")).toBe("C-OWN");
  });

  it("falls back to the default channel", () => {
    expect(resolveChannel(project(), "C-DEFAULT")).toBe("C-DEFAULT");
    expect(resolveChannel(null, "C-DEFAULT")).toBe("C-DEFAULT");
  });
});

describe("isProjectEnabled", () => {
  it("allows a project nobody has configured yet", () => {
    expect(isProjectEnabled(null)).toBe(true);
  });

  it("respects an explicit off switch", () => {
    expect(isProjectEnabled(project({ enabled: false }))).toBe(false);
    expect(isProjectEnabled(project({ enabled: true }))).toBe(true);
  });
});
