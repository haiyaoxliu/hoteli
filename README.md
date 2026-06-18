# 🏨 Hoteli

A Flighty-style hotel-history tracker. Self-hosted PWA, reached privately over
Tailscale, with every stay linking to Apple Maps. Acquires past stays by mining
your local Apple Mail and ingesting forwarded confirmations from a dummy Gmail.

> **👋 New to this / on a fresh Mac?** Read **[SETUP.md](./SETUP.md)** — a
> complete, no-experience-needed, start-to-finish guide.

## Stack

- **Next.js 16** (App Router) + React 19 + Tailwind 4, bound to `127.0.0.1`
- **SQLite** via Drizzle ORM (`hoteli.db`)
- **Auth**: Tailscale Serve identity header (`Tailscale-User-Login`) — no login screen
- **Geo**: pluggable provider — OSM Nominatim now, Apple Maps Server API later
- **Maps**: MapLibre (free tiles) in-app; deep links open Apple Maps
- **Parser**: deterministic rules first (free/offline), optional Claude fallback
- **Ingestion**: local Apple Mail `.emlx` miner + Gmail API poller, deduped via `raw_messages`
- **Review queue**: confirmations the rules can't fully extract land in `/review` for one-click add
- **PWA**: Serwist (installable, offline cache)

## Quick start (private, local, no config)

No API keys, no `.env`, no Tailscale needed. Your email is read locally and
never sent anywhere.

```bash
npm run setup    # npm install + create the local SQLite DB
npm run dev      # open http://127.0.0.1:3000
```

Then **Settings → Backfill from Apple Mail** (grant the terminal Full Disk
Access first: System Settings → Privacy & Security → Full Disk Access), or run
`npm run backfill -- you@example.com`.

### What does / doesn't leave your machine

With **no `ANTHROPIC_API_KEY`** (the default), the app prints its posture at
startup. In that mode:

| Data | Leaves machine? |
|---|---|
| Your email (subjects, bodies, confirmation codes, dates) | **No — never.** Parsed 100% on-device. |
| Email files / mailbox | **No.** Read-only, locally. |
| Hotel name + city | Sent to OpenStreetMap **only** to fetch a map pin's coordinates. |
| Map tiles | Fetched from the map provider by coordinate (for the map view). |
| Anthropic / Gmail / any cloud | **No.** LLM is only ever called if you set an API key; Gmail poller is off unless configured. |

To go further: set `LOCAL_ONLY=1` to hard-disable the LLM even if a key is
present, and/or `GEO_PROVIDER=…` to change/stop geocoding (the map needs it).
Telemetry is disabled. Fonts (Geist) are self-hosted by Next at build time, so
there's no runtime font fetch.

### Sending this to someone else

Your hotel data lives in `hoteli.db` — **delete it before sharing** so you don't
send your own stays. `.env` (if you made one) and `node_modules` should also be
excluded. Cleanest:

```bash
rm -f hoteli.db hoteli.db-* .env
# zip the folder without node_modules, or send via `git archive`
```

They then run `npm run setup && npm run dev` and get a fresh, empty database.

## Full setup (with optional extras)

```bash
npm install
cp .env.example .env        # optional — only for LLM fallback / Gmail / Tailscale
npm run db:push             # create the SQLite schema
npm run build && npm start  # serves on 127.0.0.1:3000
```

Identity resolution: Tailscale `Tailscale-User-Login` header → `DEV_USER` env →
built-in `local@hoteli.app` (so it just works locally). Over `tailscale serve`
each tailnet user becomes a distinct account.

> ⚠️ **Always bind to `127.0.0.1`** (the scripts do). The app trusts the
> `Tailscale-User-Login` header, which is only safe because `tailscale serve` is
> the sole path in. Never expose it on `0.0.0.0`/the LAN.

## Expose over Tailscale

```bash
tailscale serve --bg https / proxy 3000
# → https://<machine>.<tailnet>.ts.net  (tailnet-only; identity headers injected)
```

Each tailnet user who opens the URL becomes a distinct Hoteli user automatically.

## Acquiring past data

### 1. Local Apple Mail backfill (primary, no auth)

Mines `~/Library/Mail` on this Mac for past confirmations. Grant the
terminal/runtime **Full Disk Access** (System Settings → Privacy & Security).

```bash
ANTHROPIC_API_KEY=… npm run backfill -- you@example.com 2000
```

Re-running is safe — seen messages are skipped (idempotent via Message-ID).
Also available from **Settings → Import history → Backfill from Apple Mail**
(bounded run for the interactive button).

### 2. Forwarded email (ongoing, multi-user)

Each user has a forwarding alias shown in **Settings**
(`hoteli.inbox+<tag>@gmail.com`). Forward confirmations there (or set a Gmail
auto-forward filter). The poller routes each message to the right user by the
`+tag` and runs every 15 min (configurable via `GMAIL_POLL_CRON`).

**One-time Gmail setup:** create a Google Cloud OAuth *Desktop* client, enable
the Gmail API, obtain a refresh token (read-only scope `gmail.readonly`), and set
`GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` /
`GMAIL_ADDRESS` in `.env`.

### 3. Financial statements (future)

Phase 5: CSV/OFX import to flag lodging charges and fill gaps. Not yet built.

## Improving the parser (debug loop)

The parser uses per-provider profiles (Flighty-style) in `lib/parse/senders.ts`
plus a city gazetteer (`lib/parse/gazetteer.ts`). To improve it against real
mail, a tester runs:

```bash
npm run debug-export        # writes hoteli-debug.json (review before sharing!)
```

`hoteli-debug.json` captures, for each candidate, the subject/sender/headers, a
body excerpt, and what the parser extracted. Send that file back, then iterate
locally without their mailbox:

```bash
npm run debug-replay -- hoteli-debug.json          # re-parse + summary
npm run debug-replay -- hoteli-debug.json --geo    # also test geocoding
```

Edit the parser, re-run replay, repeat. `npm run parse-eval` does the same over
your own local mailbox. `hoteli-debug*.json` is git-ignored (real email content).

## Parsing modes

Set `PARSER` in `.env`:
- `auto` (default) — deterministic rules first; only emails the rules can't
  finish (and only if `ANTHROPIC_API_KEY` is set) escalate to the LLM.
- `heuristic` — rules only, fully free/offline (no API key needed).
- `llm` — LLM only.

The deterministic parser (`lib/parse/heuristic.ts`) gates marketing out, then
extracts hotel name / dates (via `chrono-node`) / confirmation code per sender
(`cheerio` over the HTML). Coverage is partial by design — anything it can't
fully extract but believes is a real lodging confirmation goes to the **review
queue** at `/review` (badge in the nav), where you confirm/edit and add in one
click, or dismiss. Marketing and non-lodging confirmations (flights, orders,
event/university confirmations) are rejected.

Measure coverage on your own mailbox without writing anything:

```bash
npm run parse-eval -- --show
```


## Switching to Apple Maps data

Once you have an Apple Developer membership, create a Maps key and set
`GEO_PROVIDER=applemaps` + `APPLE_MAPS_TEAM_ID/KEY_ID/PRIVATE_KEY`, then
implement the token exchange in `lib/geo/applemaps.ts`. Callers don't change.

## Run as a service (Mac mini)

See `deploy/com.hoteli.app.plist` — copy to `~/Library/LaunchAgents/`, edit the
paths/env, then `launchctl load`. Re-run `tailscale serve` on the mini.

## Layout

```
app/                 routes (timeline, map, stats, settings, stay detail) + API
components/           StayCard, StayForm, MapView, Sync/Delete controls
lib/db/              Drizzle schema + client
lib/geo/             provider interface, nominatim, applemaps, Apple Maps links
lib/parse/           Claude structured extraction
lib/ingest/          emlx miner, gmail poller, pipeline, cron, alias
scripts/backfill.ts  CLI historical backfill
```
