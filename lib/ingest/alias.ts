/**
 * The dummy inbox that receives forwarded confirmations, e.g.
 * GMAIL_ADDRESS=hoteli.inbox@gmail.com. Per-user routing uses Gmail's
 * plus-addressing: hoteli.inbox+<forwardTag>@gmail.com all land in one inbox.
 */
const BASE = process.env.GMAIL_ADDRESS ?? "hoteli.inbox@gmail.com";

export function forwardingAddress(forwardTag: string): string {
  const [local, domain] = BASE.split("@");
  return `${local}+${forwardTag}@${domain}`;
}

/** Extract the forwardTag from a recipient address, or null if none. */
export function tagFromRecipient(recipient: string): string | null {
  const m = recipient.toLowerCase().match(/\+([a-z0-9-]+)@/);
  return m ? m[1] : null;
}
