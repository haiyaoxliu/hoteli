import cron from "node-cron";
import { syncGmail } from "./gmail";

let started = false;

/**
 * Start the background Gmail poller. Call once at server startup. Controlled by
 * env: GMAIL_POLL_CRON (default every 15 min) and the Gmail credentials. No-op
 * if Gmail isn't configured.
 */
export function startIngestCron(): void {
  if (started) return;
  if (!process.env.GMAIL_REFRESH_TOKEN) return; // Gmail not set up
  started = true;

  const schedule = process.env.GMAIL_POLL_CRON ?? "*/15 * * * *";
  cron.schedule(schedule, async () => {
    try {
      const s = await syncGmail(100);
      if (s.created > 0) console.log(`[cron] Gmail sync: ${s.created} new stays`);
    } catch (err) {
      console.error("[cron] Gmail sync failed:", (err as Error).message);
    }
  });
  console.log(`[cron] Gmail poller scheduled: ${schedule}`);
}
