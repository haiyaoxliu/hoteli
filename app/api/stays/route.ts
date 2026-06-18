import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { listStaysForUser, createStayDeduped } from "@/lib/stays";
import { upsertProperty } from "@/lib/properties";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json({ stays: listStaysForUser(user.id) });
}

const propertySchema = z.object({
  name: z.string().min(1),
  brand: z.string().nullish(),
  address: z.string().nullish(),
  city: z.string().nullish(),
  country: z.string().nullish(),
  lat: z.number().nullish(),
  lng: z.number().nullish(),
  applePlaceId: z.string().nullish(),
  geoSource: z.string().nullish(),
});

const createSchema = z.object({
  property: propertySchema,
  checkIn: z.string().nullish(),
  checkOut: z.string().nullish(),
  confirmationNo: z.string().nullish(),
  roomType: z.string().nullish(),
  total: z.number().nullish(),
  currency: z.string().nullish(),
  channel: z.string().nullish(),
  notes: z.string().nullish(),
});

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { property, ...rest } = parsed.data;

  const prop = upsertProperty(property);
  const { stay, created } = createStayDeduped({
    userId: user.id,
    propertyId: prop.id,
    source: "manual",
    ...rest,
  });

  return NextResponse.json({ stay, created }, { status: created ? 201 : 200 });
}
