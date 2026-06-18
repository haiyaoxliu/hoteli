import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** A person using the app. Identified by their Tailscale login (email). */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tsLogin: text("ts_login").notNull().unique(),
  displayName: text("display_name"),
  // Slug used in the forwarding alias: inbox+<forwardTag>@gmail.com
  forwardTag: text("forward_tag").notNull().unique(),
  createdAt: integer("created_at").notNull(),
});

/** A hotel/property, shared and de-duplicated across users. */
export const properties = sqliteTable(
  "properties",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    brand: text("brand"),
    address: text("address"),
    city: text("city"),
    country: text("country"),
    lat: real("lat"),
    lng: real("lng"),
    applePlaceId: text("apple_place_id"),
    appleMapsUrl: text("apple_maps_url"),
    geoSource: text("geo_source"), // nominatim | applemaps | manual
    // normalized "name|city" used to avoid duplicate properties
    dedupKey: text("dedup_key").notNull().unique(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("properties_city_idx").on(t.city)],
);

/** A single hotel stay belonging to a user. */
export const stays = sqliteTable(
  "stays",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    propertyId: integer("property_id").references(() => properties.id),
    checkIn: text("check_in"), // ISO date (YYYY-MM-DD)
    checkOut: text("check_out"),
    confirmationNo: text("confirmation_no"),
    roomType: text("room_type"),
    total: real("total"),
    currency: text("currency"),
    channel: text("channel"), // booking | expedia | direct | airbnb | ...
    source: text("source").notNull(), // emlx | gmail | imap | manual | statement
    sourceRef: text("source_ref"),
    rawExcerpt: text("raw_excerpt"),
    notes: text("notes"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("stays_user_idx").on(t.userId),
    index("stays_checkin_idx").on(t.checkIn),
  ],
);

/**
 * Every ingested message, for idempotency and re-parsing.
 * `externalId` is the Message-ID (email) or a stable file/source key.
 */
export const rawMessages = sqliteTable(
  "raw_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source").notNull(), // emlx | gmail | imap
    // Message-ID (email) or stable file/source key. Unique PER USER, so each
    // user can independently ingest the same local mailbox.
    externalId: text("external_id").notNull(),
    userId: integer("user_id").references(() => users.id),
    subject: text("subject"),
    sender: text("sender"),
    receivedAt: integer("received_at"),
    parseStatus: text("parse_status").notNull().default("pending"), // pending|parsed|review|failed|skipped|no_match
    parseJson: text("parse_json"),
    stayId: integer("stay_id").references(() => stays.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("raw_user_external_idx").on(t.userId, t.externalId)],
);

/** Generic key/value cursor store for ingest workers. */
export const ingestState = sqliteTable("ingest_state", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: integer("updated_at").notNull(),
});

export type User = typeof users.$inferSelect;
export type Property = typeof properties.$inferSelect;
export type Stay = typeof stays.$inferSelect;
export type RawMessage = typeof rawMessages.$inferSelect;
