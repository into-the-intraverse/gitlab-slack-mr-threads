import Database from "better-sqlite3";
import { Kysely, SqliteDialect, ParseJSONResultsPlugin } from "kysely";
import type { DB } from "./schema.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type KyselyDb = Kysely<DB>;

export function openDb(databaseUrl: string): { db: KyselyDb; raw: Database.Database } {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error(`Only file: URLs supported in v1; got ${databaseUrl}`);
  }
  const filePath = databaseUrl.slice("file:".length);
  mkdirSync(dirname(filePath), { recursive: true });
  const raw = new Database(filePath);
  raw.pragma("journal_mode = WAL");
  raw.pragma("synchronous = NORMAL");
  raw.pragma("foreign_keys = ON");
  const db = new Kysely<DB>({
    dialect: new SqliteDialect({ database: raw }),
    plugins: [new ParseJSONResultsPlugin()],
  });
  return { db, raw };
}
