import { eq } from "drizzle-orm";
import { db } from "./db/client";
import { users, type User } from "./db/schema";

function makeForwardTag(login: string, id: number): string {
  const local =
    login.split("@")[0]?.toLowerCase().replace(/[^a-z0-9]+/g, "") || "user";
  return `${local}-${id.toString(36)}`;
}

/** Find-or-create a user by their login (Tailscale email). */
export function upsertUser(tsLogin: string, displayName: string | null = null): User {
  const existing = db.select().from(users).where(eq(users.tsLogin, tsLogin)).get();
  if (existing) {
    if (displayName && displayName !== existing.displayName) {
      db.update(users).set({ displayName }).where(eq(users.id, existing.id)).run();
    }
    return existing;
  }

  const inserted = db
    .insert(users)
    .values({
      tsLogin,
      displayName,
      forwardTag: `tmp-${tsLogin}`,
      createdAt: Date.now(),
    })
    .returning()
    .get();

  return db
    .update(users)
    .set({ forwardTag: makeForwardTag(tsLogin, inserted.id) })
    .where(eq(users.id, inserted.id))
    .returning()
    .get();
}
