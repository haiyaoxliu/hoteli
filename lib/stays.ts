import { and, desc, eq } from "drizzle-orm";
import { db } from "./db/client";
import { stays, properties, type Stay, type Property } from "./db/schema";

export interface StayWithProperty {
  stay: Stay;
  property: Property | null;
}

export function listStaysForUser(userId: number): StayWithProperty[] {
  const rows = db
    .select({ stay: stays, property: properties })
    .from(stays)
    .leftJoin(properties, eq(stays.propertyId, properties.id))
    .where(eq(stays.userId, userId))
    .orderBy(desc(stays.checkIn))
    .all();
  return rows;
}

export function getStay(userId: number, id: number): StayWithProperty | null {
  const row = db
    .select({ stay: stays, property: properties })
    .from(stays)
    .leftJoin(properties, eq(stays.propertyId, properties.id))
    .where(and(eq(stays.id, id), eq(stays.userId, userId)))
    .get();
  return row ?? null;
}

export interface CreateStayInput {
  userId: number;
  propertyId?: number | null;
  checkIn?: string | null;
  checkOut?: string | null;
  confirmationNo?: string | null;
  roomType?: string | null;
  total?: number | null;
  currency?: string | null;
  channel?: string | null;
  source: string;
  sourceRef?: string | null;
  rawExcerpt?: string | null;
  notes?: string | null;
}

/**
 * Insert a stay, skipping duplicates. A stay is considered a duplicate when it
 * shares a confirmation number with an existing one, or (when there is no
 * confirmation number) the same user + property + check-in date.
 */
export function createStayDeduped(input: CreateStayInput): { stay: Stay; created: boolean } {
  if (input.confirmationNo) {
    const dup = db
      .select()
      .from(stays)
      .where(
        and(
          eq(stays.userId, input.userId),
          eq(stays.confirmationNo, input.confirmationNo),
        ),
      )
      .get();
    if (dup) return { stay: dup, created: false };
  } else if (input.propertyId && input.checkIn) {
    const dup = db
      .select()
      .from(stays)
      .where(
        and(
          eq(stays.userId, input.userId),
          eq(stays.propertyId, input.propertyId),
          eq(stays.checkIn, input.checkIn),
        ),
      )
      .get();
    if (dup) return { stay: dup, created: false };
  }

  const stay = db
    .insert(stays)
    .values({ ...input, createdAt: Date.now() })
    .returning()
    .get();
  return { stay, created: true };
}

export function updateStay(
  userId: number,
  id: number,
  patch: Partial<CreateStayInput>,
): Stay | null {
  const row = db
    .update(stays)
    .set(patch)
    .where(and(eq(stays.id, id), eq(stays.userId, userId)))
    .returning()
    .get();
  return row ?? null;
}

export function deleteStay(userId: number, id: number): boolean {
  const row = db
    .delete(stays)
    .where(and(eq(stays.id, id), eq(stays.userId, userId)))
    .returning()
    .get();
  return !!row;
}
