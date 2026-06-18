import { headers } from "next/headers";
import { type User } from "./db/schema";
import { upsertUser } from "./users";

/**
 * Resolve the current user.
 *
 * Order of precedence:
 *   1. Tailscale Serve identity header (`Tailscale-User-Login`) — real per-user
 *      identity when reached over `tailscale serve`.
 *   2. DEV_USER env (local development override).
 *   3. A built-in single-user default, so the app works locally with zero config
 *      (e.g. a friend just running it on their MacBook).
 *
 * SECURITY: the header is only trustworthy because the app binds to 127.0.0.1
 * and is reached through `tailscale serve`. Never expose it on 0.0.0.0 / the LAN.
 */
const LOCAL_DEFAULT_USER = "local@hoteli.app";

export async function getCurrentUser(): Promise<User> {
  const h = await headers();
  const login =
    h.get("tailscale-user-login") ?? process.env.DEV_USER ?? LOCAL_DEFAULT_USER;
  const name = h.get("tailscale-user-name") ?? null;
  return upsertUser(login, name);
}
