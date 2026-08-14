import type { KyselyDb } from "../db/index.js";
import { recordSettingsChange } from "../persistence/settings-audit.js";
import { type Actor, SETTINGS_DEFAULTS, type Settings, settingsSchema } from "./schema.js";

export type SettingsStore = {
  read(): Promise<Settings>;
  write(changes: Partial<Settings>, actor: Actor): Promise<void>;
  /** Compiled `jira_key_regex`, memoised by its source string. */
  jiraKeyRegex(): Promise<RegExp>;
};

/**
 * Reads are deliberately uncached. A local SQLite read costs tens of
 * microseconds, so a burst of a hundred queued events costs milliseconds — and
 * a cache would only buy invalidation bugs of the "I changed it and nothing
 * happened" kind, which is the whole reason settings moved here.
 */
export function makeSettingsStore(db: KyselyDb): SettingsStore {
  // The one exception: building a RegExp per event is wasteful. Keyed by the
  // source string, so a change takes effect without an invalidation call.
  let memoSource: string | null = null;
  let memoRegex: RegExp | null = null;

  async function read(): Promise<Settings> {
    const rows = await db.selectFrom("settings").select(["key", "value"]).execute();
    const raw: Record<string, unknown> = { ...SETTINGS_DEFAULTS };
    for (const row of rows) {
      if (!(row.key in SETTINGS_DEFAULTS)) continue;
      // ParseJSONResultsPlugin already turns object-shaped values into objects,
      // so `user_map` arrives parsed while scalars arrive as JSON text.
      const stored: unknown = row.value;
      if (typeof stored !== "string") {
        raw[row.key] = stored;
        continue;
      }
      try {
        raw[row.key] = JSON.parse(stored);
      } catch {
        // A hand-edited row should degrade to the default, not stop the worker.
      }
    }
    const parsed = settingsSchema.safeParse(raw);
    return parsed.success ? parsed.data : SETTINGS_DEFAULTS;
  }

  return {
    read,

    async write(changes, actor) {
      const current = await read();
      // Validate the merged object so one bad field rejects the whole write.
      const next = settingsSchema.parse({ ...current, ...changes });
      const now = new Date().toISOString();

      for (const key of Object.keys(changes) as Array<keyof Settings>) {
        const oldValue = JSON.stringify(current[key]);
        const newValue = JSON.stringify(next[key]);
        if (oldValue === newValue) continue;

        await db
          .insertInto("settings")
          .values({ key, value: newValue, updated_at: now })
          .onConflict((oc) => oc.column("key").doUpdateSet({ value: newValue, updated_at: now }))
          .execute();

        await recordSettingsChange(db, {
          at: now,
          actor_user_id: actor.userId,
          actor_name: actor.name,
          scope: "global",
          key,
          old_value: oldValue,
          new_value: newValue,
        });
      }
    },

    async jiraKeyRegex() {
      const { jira_key_regex } = await read();
      if (jira_key_regex !== memoSource || !memoRegex) {
        // Case-insensitive: people type `abc-1234` as often as `ABC-1234`.
        memoRegex = new RegExp(jira_key_regex, "i");
        memoSource = jira_key_regex;
      }
      return memoRegex;
    },
  };
}
