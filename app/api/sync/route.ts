import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { backfillFromAppleMail } from "@/lib/ingest/emlx";
import { syncGmail } from "@/lib/ingest/gmail";

export const dynamic = "force-dynamic";
// Allow long-running ingestion (LLM calls per candidate).
export const maxDuration = 300;

const bodySchema = z.object({
  source: z.enum(["emlx", "gmail"]),
  maxCandidates: z.number().int().positive().max(100_000).optional(),
});

// On-device parsing is free, so scan everything. With an LLM key, cap the
// interactive run (each candidate is an API call) — the CLI can go higher.
function defaultCap(): number {
  const llm = process.env.LOCAL_ONLY !== "1" && !!process.env.ANTHROPIC_API_KEY;
  return llm ? 200 : 100_000;
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const cap = parsed.data.maxCandidates ?? defaultCap();

  try {
    if (parsed.data.source === "emlx") {
      return NextResponse.json(await backfillFromAppleMail(user.id, { maxCandidates: cap }));
    }
    return NextResponse.json(await syncGmail(cap));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
