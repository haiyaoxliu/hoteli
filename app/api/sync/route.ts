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
  // Optional cost guard for the interactive button; the CLI can go higher.
  maxCandidates: z.number().int().positive().max(2000).optional(),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  try {
    if (parsed.data.source === "emlx") {
      const s = await backfillFromAppleMail(user.id, {
        maxCandidates: parsed.data.maxCandidates ?? 50,
      });
      return NextResponse.json(s);
    } else {
      const s = await syncGmail(parsed.data.maxCandidates ?? 50);
      return NextResponse.json(s);
    }
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
