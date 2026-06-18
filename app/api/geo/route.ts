import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getGeoProvider } from "@/lib/geo";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  await getCurrentUser(); // require an authenticated tailnet user
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q || q.length < 3) return NextResponse.json({ results: [] });

  try {
    const results = await getGeoProvider().search(q);
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json(
      { results: [], error: (err as Error).message },
      { status: 502 },
    );
  }
}
