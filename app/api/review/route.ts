import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listReviewForUser } from "@/lib/review";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json({ items: listReviewForUser(user.id) });
}
