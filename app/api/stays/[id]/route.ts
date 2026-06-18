import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { updateStay, deleteStay } from "@/lib/stays";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  checkIn: z.string().nullish(),
  checkOut: z.string().nullish(),
  confirmationNo: z.string().nullish(),
  roomType: z.string().nullish(),
  total: z.number().nullish(),
  currency: z.string().nullish(),
  channel: z.string().nullish(),
  notes: z.string().nullish(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  const id = Number((await params).id);
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const stay = updateStay(user.id, id, parsed.data);
  if (!stay) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ stay });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  const id = Number((await params).id);
  const ok = deleteStay(user.id, id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
