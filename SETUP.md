# Hoteli — Setup on a fresh Mac (start to finish)

This guide assumes a brand-new MacBook with **nothing installed**. No prior
coding experience needed — just follow each step in order. It takes ~15 minutes.

**Privacy promise:** Hoteli reads your hotel confirmations from the Mail app
**on your Mac only**. With no API key (the default), none of your email is ever
sent anywhere. See the bottom of this file for exactly what does/doesn't leave
your machine.

---

## Before you start: your email must be in the Mac "Mail" app

Hoteli scans the **Mail** app's local files. If you only read email in a web
browser, there's nothing on the Mac for it to find.

1. Open the **Mail** app (it's pre-installed; find it with Spotlight: press
   `⌘ Space`, type **Mail**, hit Return).
2. If your email isn't there yet, add it: **Mail → Settings → Accounts → +** and
   sign in (Gmail, iCloud, Outlook, etc.).
3. Let Mail finish downloading your messages (give it a few minutes the first
   time). The more history it has synced, the more hotels Hoteli can find.

---

## Step 1 — Install Node.js

Node.js is the engine that runs the app. Pick **one** of the two options below.

### Option A (recommended) — Homebrew

Homebrew is the standard macOS package manager. This route also installs Apple's
developer tools, which makes the later steps smoother.

1. Open **Terminal**: press `⌘ Space`, type **Terminal**, hit Return.
2. Install Homebrew — copy-paste this whole line into Terminal and press Return.
   It will ask for your Mac password (you won't see it as you type — that's
   normal) and take a few minutes:

   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

3. When it finishes, it prints a **"Next steps"** box with two `eval`/`echo`
   commands. On Apple-silicon Macs (M1/M2/M3/M4), run these so your Terminal can
   find Homebrew (copy-paste both lines):

   ```bash
   echo >> ~/.zprofile
   echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
   eval "$(/opt/homebrew/bin/brew shellenv)"
   ```

   (On older Intel Macs you can skip step 3.)

4. Install Node:

   ```bash
   brew install node
   ```

5. Check it worked — this should print a version number:

   ```bash
   node --version
   ```

Homebrew also installs `git`, so if you prefer you can grab the code with
`git clone` in Step 2.

### Option B — Direct download (no Terminal)

1. Go to **https://nodejs.org**.
2. Click the big **"LTS"** button. It downloads a file ending in `.pkg`.
3. Open the downloaded file and click through the installer (Continue → Agree →
   Install). Enter your Mac password if asked.

---

## Step 2 — Get the Hoteli code

**Easiest way (no extra tools):**

1. Go to **https://github.com/haiyaoxliu/hoteli**.
2. Click the green **`< > Code`** button → **Download ZIP**.
3. Open your **Downloads** folder and double-click `hoteli-main.zip` to unzip it.
   You'll get a folder named **`hoteli-main`**.

(If you'd rather use git and already have it, `git clone
git@github.com:haiyaoxliu/hoteli.git` works too.)

---

## Step 3 — Open Terminal in that folder

"Terminal" is the app where you type the commands below.

1. Open Terminal: press `⌘ Space`, type **Terminal**, hit Return.
2. In the Terminal window, type `cd ` — that's the letters **c**, **d**, then a
   **space**. Don't press Return yet.
3. Drag the **`hoteli-main`** folder from Finder directly onto the Terminal
   window. It pastes the folder's path automatically.
4. Now press **Return**.

Your Terminal is now "inside" the project folder. Leave this window open.

---

## Step 4 — Install and set up (one time)

In that same Terminal window, copy-paste this line and press Return:

```bash
npm run setup
```

This downloads the app's building blocks and creates an empty local database.
It takes a couple of minutes and prints a lot of text — that's normal. Wait
until you get your prompt back.

> If it finishes with errors mentioning **"better-sqlite3"** or a compiler,
> run `xcode-select --install`, click **Install**, wait for it to finish, then
> run `npm run setup` again.

---

## Step 5 — Let Hoteli read the Mail app's files

macOS protects your Mail folder, so you must give **Terminal** permission once:

1. Open **System Settings** (Apple menu  → System Settings).
2. Go to **Privacy & Security → Full Disk Access**.
3. Find **Terminal** in the list and turn its switch **on**. If it's not listed,
   click the **`+`** button, go to **Applications → Utilities → Terminal**, and
   add it.
4. **Quit Terminal completely** (`⌘ Q`) and reopen it, then redo Step 3 (the
   `cd` + drag-the-folder trick) so you're back inside the project folder.

---

## Step 6 — Start the app

In Terminal, run:

```bash
npm run dev
```

Wait for it to say **`Ready`**. You'll also see a short "privacy posture" note
confirming nothing is being sent off your machine.

Now open a web browser and go to:

```
http://localhost:3000
```

You'll see Hoteli. It's empty for now.

> Keep the Terminal window open while you use the app — closing it or pressing
> `Control C` stops the app. To use it again later, reopen Terminal, repeat
> Step 3, and run `npm run dev`.

---

## Step 7 — Import your hotel history

In the app:

1. Click **Settings** (top right).
2. Click **Backfill from Apple Mail**.
3. Wait — it reads your local mail, finds hotel confirmations, and adds them.
   When done it tells you how far back it looked (e.g. "emails from 2015 to
   today").

Then check:

- **Stays** — confirmed hotels (name, dates, confirmation, and a map pin).
- **Review** — confirmations it found but couldn't fully read; fill in the
  blanks and click **Add**, or **Dismiss**.
- **Map** and **Stats** — the fun views.

You can also add a stay by hand with the **+ Add** button.

---

## Everyday use

- **Start it:** open Terminal → `cd ` + drag the folder + Return → `npm run dev`
  → open `http://localhost:3000`.
- **Stop it:** click the Terminal window and press `Control C` (or just close it).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `npm: command not found` | Quit Terminal (`⌘ Q`) and reopen so it picks up the new install. If you used Homebrew, make sure you ran the `eval "$(/opt/homebrew/bin/brew shellenv)"` line from Step 1.3. |
| `brew: command not found` | The Step 1.3 PATH lines didn't run. Re-paste them, or quit and reopen Terminal. |
| Errors building **better-sqlite3** during setup | Run `xcode-select --install`, finish it, then `npm run setup` again. |
| Backfill finds **nothing** | The app now tells you why right under the button. The two usual causes: (1) **Mail is still downloading** — open Mail, wait until it's done (see Gmail note below), then retry; (2) **Full Disk Access** isn't granted to Terminal (Step 5) — grant it, then fully quit/reopen Terminal and retry. The "Mailboxes scanned" list shows which inboxes it could read. |
| Backfill works but **misses older hotels** (Gmail) | Apple Mail may only be syncing your **Inbox**. In **Mail → Settings → Accounts → your Gmail → Mailbox Behaviors**, and in Gmail's web settings (Labels → show "All Mail" in IMAP), make sure **All Mail** is available, then let Mail finish downloading and run backfill again. |
| "Port 3000 in use" | Something else is using it. Close other copies of the app, or restart your Mac. |
| Page won't load | Make sure the Terminal still shows the app running and you used `http://localhost:3000`. |
| `no such table: users` (or similar) | Update to the latest version (`git pull` or re-download) and restart `npm run dev` — the database now creates itself automatically on startup. |

---

## What does and doesn't leave your Mac

With no API key (the default):

| Data | Leaves your Mac? |
|---|---|
| Your emails (subjects, bodies, confirmation codes, dates) | **No — never.** Read and parsed entirely on your Mac. |
| Your mailbox files | **No.** Read-only, locally. |
| Hotel name + city | Sent to OpenStreetMap **only** to look up a map pin's location. |
| Map images | Loaded from a map provider to draw the map. |
| Anything to Google / Apple / AI services | **No.** |

If you want zero network use at all, you can skip the map — ask the person who
sent you this and they can flip a setting.
