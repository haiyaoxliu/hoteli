export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const llm =
      process.env.LOCAL_ONLY !== "1" && !!process.env.ANTHROPIC_API_KEY;
    const gmail = !!process.env.GMAIL_REFRESH_TOKEN;
    console.log(
      [
        "",
        "🏨 Hoteli — privacy posture",
        `   • Email parsing:   ${llm ? "on-device + LLM fallback (API key set)" : "100% on-device (no API key → email content never sent)"}`,
        `   • Email source:    local Apple Mail, read-only${gmail ? " + Gmail poller (configured)" : " (Gmail poller off)"}`,
        `   • Leaves machine:  ${llm ? "email text to Anthropic (LLM)," : ""} hotel name+city to OpenStreetMap & map tiles (for the map only)`,
        "",
      ].join("\n"),
    );
    const { startIngestCron } = await import("./lib/ingest/cron");
    startIngestCron();
  }
}
