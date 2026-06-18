import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { resolveReview, dismissReview } from "@/lib/review";

export const dynamic = "force-dynamic";

const resolveSchema = z.object({
  name: z.string().min(1),
  city: z.string().nullish(),
  country: z.string().nullish(),
  checkIn: z.string().nullish(),
  checkOut: z.string().nullish(),
  confirmationNo: z.string().nullish(),
  channel: z.string().nullish(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  const id = Number((await params).id);
  const parsed = resolveSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const ok = await resolveReview(user.id, id, parsed.data);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  const id = Number((await params).id);
  const ok = dismissReview(user.id, id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
