import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import * as schema from "./schema";
import { ensureSchema } from "./ensure-schema";

// Single shared connection. Stored under the project root by default; override
// with HOTELI_DB for the Mac mini deployment.
const dbPath = process.env.HOTELI_DB ?? path.join(process.cwd(), "hoteli.db");

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// Create the schema on first use so the app runs without a manual db:push.
ensureSchema(sqlite);

export const db = drizzle(sqlite, { schema });
export { schema };
