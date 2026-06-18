/**
 * Full historical backfill from the local Apple Mail store.
 *
 *   HOTELI_DB=./hoteli.db ANTHROPIC_API_KEY=... \
 *     npm run backfill -- you@example.com [maxCandidates]
 *
 * Requires Full Disk Access for the terminal/runtime on macOS.
 */
import { upsertUser } from "../lib/users";
import { backfillFromAppleMail } from "../lib/ingest/emlx";

async function main() {
  const login = process.argv[2] ?? process.env.DEV_USER;
  if (!login) {
    console.error("Usage: npm run backfill -- <your-email> [maxCandidates]");
    process.exit(1);
  }
  const max = process.argv[3] ? Number(process.argv[3]) : 2000;

  const user = upsertUser(login);
  console.log(`Backfilling for ${login} (user #${user.id}), cap ${max} candidates…`);

  const summary = await backfillFromAppleMail(user.id, {
    maxCandidates: max,
    onProgress: (s) => {
      if (s.scanned % 10 === 0) {
        process.stdout.write(
          `\r  scanned ${s.scanned} · new ${s.created} · skipped ${s.skipped} · no-match ${s.noMatch}`,
        );
      }
    },
  });

  const fmt = (ms: number | null) =>
    ms ? new Date(ms).toISOString().slice(0, 10) : "—";
  console.log(
    `\nScanned ${summary.filesSeen} emails (${fmt(summary.oldest)} → ${fmt(
      summary.newest,
    )}) · logged ${summary.created} · review ${summary.review} · not-a-confirmation ${summary.noMatch}`,
  );
  if (summary.mailboxes.length) {
    console.log("Mailboxes scanned:");
    for (const m of summary.mailboxes) console.log(`  • ${m.name}: ${m.count}`);
  }
  if (summary.note) console.log(`\nNote: ${summary.note}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
