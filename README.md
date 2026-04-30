# 🔬 Webhook Inspector

A lightweight, real-time webhook inspector built with **NestJS** and
**Vue 3**. It receives HTTP callbacks from any external service and
displays the payloads instantly in the browser via WebSocket — no page
refresh required.

Two interfaces share the same store: a **graphical inspector** for
mouse-driven exploration and a **first-person terminal** with pipelines,
live tail, JSON tree output, and clickable arrival links. Either can be
the operator's daily driver.

Each session generates a unique callback URL. Share that URL as the
`callback_url` (or equivalent) parameter in any service that supports
webhook delivery on job completion.

---

## ✨ Features

### Core inspector
- 📡 **Real-time delivery** — payloads appear instantly via WebSocket
- 🗂️ **Session-based isolation** — each session has its own callback
  URL; multiple sessions run simultaneously without interference
- 💾 **SQLite-backed sessions** — backend persists every session to a
  Docker-volume-mounted SQLite file. Rebuilds, restarts and OOM kills
  no longer wipe live sessions; expired rows are purged at boot.
- 🧠 **IndexedDB storage** — payloads, theme, locale, and super-mode
  state persist locally in the browser.
- 🌲 **Interactive JSON viewer** — collapsible tree view, raw mode, copy
- 📋 **One-click copy** for callback URLs and payloads
- 🐳 **Docker-first** — `docker-compose up --build` runs everything

### Terminal mode (TUI)
- 🖥️ **Full shell** — toggle from the gear menu or run `gui`/`exit`
  to flip back. Pipelines (`|`), history (↑/↓), tab-completion, Ctrl+C
  to abort foreground jobs, Ctrl+L to clear.
- 📜 **Many built-in commands** — `ls`, `cat`, `head`, `tail -f`,
  `grep`, `sed`, `awk`, `cut`, `wc`, `uniq`, `jq`, `copy`, `wget`,
  `ping`, `info`, plus session ones (`new`, `select`, `open`, `rm`).
- 🎨 **Rich output** — JSON trees, structured callback blocks,
  fastfetch-style info banner, clickable arrival links that open the
  detail viewer at the right callback.
- 🌐 **5 terminal palettes** — Phosphor Green, Amber CRT, Cathode Blue,
  Solarized Term, Nord Term. Independent from the GUI theme.
- 🔁 **Bare-slug shortcut** — type a session slug + Enter to select it
  and watch new callbacks land in the prompt as clickable rows.

### UI customisation
- 🌍 **8 languages** — English (US), English (UK), Português (BR),
  Português (PT), Español (ES), Français, Català, Deutsch
- 🎨 **22 hand-tuned GUI themes** (light + dark) including Midnight Lab,
  Aurora Borealis, Sakura Bloom, Dracula, Solarized Dawn, Nordic Frost,
  Neon Cyberpunk, Green Terminal, and more
- ⚙️ **Settings popover** — gear icon in the sidebar; theme, language
  and view-mode toggle live here. All choices persist in IndexedDB and
  survive reloads until the DB is cleared.

### Optional protections (all opt-in via `.env`)
- 🔐 **Login screen** with TOTP (Google / Microsoft Authenticator / 1Password / …)
  - Homemade anti-bot challenge (5-fail → 60-second IP lockout)
  - JWT in memory + sessionStorage (closing the tab logs out)
  - Silent token refresh while the tab stays open
  - Hidden master-password gate that reveals an `otpauth://` QR code
    rendered locally in the active theme
- 🛡️ **Origin filtering** — strict CORS allow list seeded from
  `UI_ORIGIN`, plus a runtime add/remove "Super Mode" panel
- 🚧 **Built-in safety**: UUID v4 session IDs, TTL expiry, request rate
  limiting, Helmet headers, payload-size cap, callback endpoint always
  returns 200 (no information leakage)

---

## 🏗️ Architecture

```
INTERNET
    │  HTTPS (443) + WSS
    ▼
┌──────────────────────────────────────────────┐
│  Reverse Proxy (Nginx / Caddy / Cloudflare)  │
│  callback.yourdomain.com → 127.0.0.1:3901    │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│  Docker Network: ai-callback-network         │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  frontend (nginx, USER nginx)          │  │
│  │  Internal :8080 → host 127.0.0.1:3901  │  │
│  │  • Serves Vue 3 SPA                    │  │
│  │  • limit_req_zone, server_tokens off   │  │
│  │  • CSP, HSTS, anti-smuggling headers   │  │
│  │  • CF-Connecting-IP only forwarded     │  │
│  │    when upstream is in trusted CIDR    │  │
│  │  • Proxies /api/*    → backend:3900    │  │
│  │  • Proxies /socket.io/ → backend       │  │
│  └────────────────┬───────────────────────┘  │
│                   │ internal network         │
│  ┌────────────────▼───────────────────────┐  │
│  │  backend (NestJS)  :3900               │  │
│  │  • REST API (sessions, callbacks)      │  │
│  │  • Socket.IO gateway (JWT-gated        │  │
│  │    when AUTH_ENABLED=true)             │  │
│  │  • Auth: TOTP + JWT + captcha          │  │
│  │  • Admin: runtime CORS allow list      │  │
│  │  • SQLite session store + cache        │  │
│  │  • Boot-time cleanup of expired        │  │
│  └────────────────────────────────────────┘  │
│                   │                          │
│  ┌────────────────▼───────────────────────┐  │
│  │  named volume: ai-callback-data        │  │
│  │  /app/data/sessions.db (SQLite)        │  │
│  │  Survives image rebuilds + restarts    │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘

Browser (IndexedDB v2)
  • sessions          — session list (mirrors the server side)
  • entries           — all callback payloads
  • settings          — theme, locale, super-mode unlock + admin token
  Persists across page reloads. Clearing IDB resets ALL of the above.

Browser (sessionStorage)
  • auth.token        — JWT (only when AUTH_ENABLED=true)
  • auth.expiresAt
  Cleared automatically when the tab is closed → automatic logout.
```

---

## 🚀 Quick Start

### Prerequisites

| Requirement    | Version | Notes                                          |
|----------------|---------|------------------------------------------------|
| Docker         | ≥ 24.x  | [Install](https://docs.docker.com/get-docker/) |
| Docker Compose | ≥ 2.x   | Included with Docker Desktop                   |
| Git            | any     |                                                |

> **No Node.js required on the host** — all builds run inside Docker.

### 1. Clone

```bash
git clone https://github.com/YOUR_USERNAME/ai-callback-explorer.git
cd ai-callback-explorer
```

### 2. Copy and edit `.env`

```bash
cp .env.example .env
# Open .env and adjust values for your deployment.
# For a local-only setup with no login or origin filtering, the
# defaults are fine — no edits needed.
```

### 3. Generate lock files (one-time)

The repo ships a Dockerised npm helper so **no Node.js is needed on the
host**. Run the wrapper from the project root:

```bash
./build.sh lockfile           # regenerates package-lock.json in backend/ + frontend/
```

The helper container is built once (mirrors `node:20-alpine` to match
the runtime images), launched with `--rm`, and bind-mounts the project
so generated files land back on the host with your UID. Other helper
commands:

```bash
./build.sh                    # install deps + lockfiles (default)
./build.sh build              # install + npm run build (produces dist/)
./build.sh shell              # drop into a shell in the helper container
./build.sh clean              # wipe node_modules/, dist/, .build-cache/
```

> If you see a `DEPRECATED: legacy builder` notice, install the buildx
> plugin to silence it:
> `sudo pacman -S docker-buildx` (Arch/Manjaro) or
> `sudo apt install docker-buildx-plugin` (Debian/Ubuntu).

### 4. Build and start

```bash
docker compose up -d --build
```

The first build takes 2–4 minutes. Subsequent builds reuse Docker layer
cache.

### 5. Open the app

```
http://localhost:3901
```

If `AUTH_ENABLED=false` (default), you land directly in the inspector.
Otherwise you'll see the login screen first — see
[Login & Authentication](#-login--authentication-optional) below.

---

## 📖 Usage

### Creating a session

1. Click **+** in the left sidebar
2. Give the session a descriptive name (or accept the date-stamped default)
3. Click **Create Session**
4. A unique callback URL is generated:
   ```
   http://localhost:3901/api/callback/xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx
   ```
5. Copy the URL via the 📋 icon under the session name

### Returning to the home view

- Click **the active session** in the sidebar — it deselects and the
  empty state reappears.
- Or click the **🔬 logo / app title** in the top-left corner.

### Receiving a callback

Pass the callback URL as the webhook destination in any service that
supports HTTP callbacks. When the service POSTs to that URL, the
payload appears **instantly** in the session panel.

### Simulating a callback

```bash
SESSION_ID="paste-your-session-id-here"

curl -X POST "http://localhost:3901/api/callback/${SESSION_ID}" \
  -H "Content-Type: application/json" \
  -d '{ "status": "completed", "message": "It works." }'
```

### Themes & language

Open the **gear icon** in the sidebar header to switch theme or
language. Both choices persist in IndexedDB and travel across reloads.

The included themes:

| Mode  | Themes |
|-------|--------|
| Dark  | Midnight Lab, Aurora Borealis, Whispering Forest, Obsidian Black, Tuscan Sunset, Deep Ocean, Monokai Pro, Dracula, Neon Cyberpunk, Espresso Bar, Coral Reef, Saffron Spice, Green Terminal |
| Light | **Porcelain (default)**, Sakura Bloom, Nordic Frost, Solarized Dawn, Antique Sepia, Matcha Tea, Rose Quartz, Arctic Glacier, Lavender Dusk |

The terminal mode has its own palette set (independent from the GUI):
**Nord Term (default)**, **Phosphor Green**, **Amber CRT**, **Cathode Blue**,
**Solarized Term**. Switch with the `theme` command (opens a TUI picker
showing both GUI and terminal palettes).

---

## 🖥️ Terminal mode

Toggle to terminal mode from the gear-icon settings popover (or run
`gui` / `exit` inside the terminal to flip back). The terminal shares
the same store as the GUI — sessions and callbacks are visible from
both views simultaneously.

### Boot banner (`info`)

When the terminal starts, a fastfetch-style banner shows the app icon,
your user, browser, host, current session, locale, GUI/TUI themes,
timezone, current time, plus the keyboard-shortcut hints. Re-print it
any time with `info`.

### Command groups

| Group | Commands |
|-------|----------|
| Sessions & callbacks | `new`, `ls` (with `-l`), `select`, `open`, `rm`, `cat`, `head`, `tail` (`-f` follow) |
| Network              | `wget` (HTTP request, JSON envelope), `ping` (URL → ok/fail) |
| Text pipes | `grep`, `sed`, `awk`, `cut` (`-c`/`-d`/`-f`), `wc`, `uniq`, `jq`, `echo`, `copy` |
| System & display | `info`, `config`, `language`, `theme`, `time`, `date`, `hour`, `pwd`, `clear`, `gui`, `exit` |
| Super mode | `origins`, `origin-add`, `origin-rm`, `share` (hidden until unlocked) |
| Help | `help`, `man <command>` |

### Quick demos

```bash
# Bare-slug shortcut: type a session slug + Enter to select it.
# The terminal lists existing callbacks as clickable rows and keeps
# streaming new ones as `[ POST /api/callback/<id> ]` arrival links.
my-session

# Tail the live stream as structured blocks (every detail field, no
# truncation). Auto-selects the session so the WS room is joined.
tail -f my-session

# Grep through tail output, then count.
tail -f my-session | grep -i error | wc -l

# HTTP probe with JSON envelope, pipeable to jq.
wget https://api.example/foo | jq .body.id
ping https://api.example/health   # → ok HTTP 200 / fail callout

# Open language / theme pickers (full-screen TUI lists, ↑/↓ + Enter).
language
theme
```

### Output format

Long-form locale-aware timestamps in `ls -l` and structured callback
blocks (`pt-BR` → `21/04/2026:14:30:45`, `en-US` →
`04/21/2026:14:30:45`, `de` → `21.04.2026:14:30:45`).
Clicking any `[ METHOD /path ]` arrival link opens the SessionView at
that exact callback.

---

## 💾 Server-side session persistence

Session metadata (id, label, createdAt, lastActivity, callback counts)
is stored in **SQLite** via `better-sqlite3`. The file lives at
`SQLITE_PATH` (default `/app/data/sessions.db`) on the
`ai-callback-data` Docker volume — so rebuilds, container removals,
and OOM kills no longer wipe live sessions.

Lifecycle:

1. **Boot** — `SessionService.onModuleInit()` runs a single
   `DELETE FROM sessions WHERE …` that purges everything past the TTL
   or first-use grace, then loads the survivors into the in-memory
   cache.
2. **Runtime** — every mutation (`createSession`, `touchSession`,
   `recordCallback`, `deleteSession`) is a write-through: cache + disk
   updated synchronously. Reads stay zero-IO from the cache.
3. **Periodic sweep** — every 10 minutes the same SQL purge runs,
   matched by an in-memory iteration so the two paths can't drift.

The frontend cross-checks every locally-known session against
`GET /api/sessions/:id/validate` on startup and tags rows in three
states (visible in `ls -l` and the GUI sidebar):

| State | Meaning | Visual |
|-------|---------|--------|
| **live** | Server recognises it; callbacks will land. | Normal |
| **expired** | TTL elapsed; backend cleaned it up. End of life. | Muted, struck-through, danger-toned `[expired]` tag |
| **orphaned** | Server returned 404 but TTL hasn't elapsed yet — typically means the SQLite volume was wiped. The session didn't expire; the server simply forgot it. | Muted with warning-toned `[orphaned]` tag — recoverable by recreating |

> Wipe the SQLite volume manually with
> `docker volume rm ai-callback-explorer_ai-callback-data`. Useful for
> development resets; never needed in production unless you actually
> want every session gone.

---

## 🔐 Login & Authentication (optional)

Set `AUTH_ENABLED=true` in `.env` to require an authenticator-app TOTP
code before the UI is reachable. With the default `AUTH_ENABLED=false`,
the SPA loads directly with no login screen and no JWT — useful for
local development.

### Required env vars when `AUTH_ENABLED=true`

| Variable             | Purpose |
|----------------------|---------|
| `TOTP_SECRET`        | RFC 4648 base32 (≥16 chars). One shared secret for the whole app — every operator registers it once in their authenticator. |
| `MASTER_PASSWORD`    | Gates the in-app QR-reveal flow (see below). Empty disables QR reveal. |
| `JWT_SECRET`         | Signing key for issued tokens. ≥32 random bytes. The backend refuses to start if this is empty while auth is enabled. |
| `TOTP_ISSUER`        | Display name in authenticator apps (default `AI Callback Explorer`). |
| `TOTP_LABEL`         | Account label in authenticator apps (default `admin`). |
| `AUTH_TOKEN_TTL_SEC` | Access-token lifetime (60–3600, default 900). |

Generate the secrets:

```bash
# JWT_SECRET (32 random bytes, base64)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# TOTP_SECRET — RFC 4648 base32, only A–Z and 2–7. The simplest way uses
# coreutils, present on every standard Linux:
head -c 20 /dev/urandom | base32 | tr -d '='
# 20 random bytes = 160 bits = 32 base32 characters, the size every
# authenticator app expects. The `tr -d '='` strips padding that some
# apps reject.

# Python alternative (if you prefer not to use coreutils):
python3 -c "import secrets, base64; print(base64.b32encode(secrets.token_bytes(20)).decode().rstrip('='))"

# Node alternative (works inside the backend container):
node -e "
  const a='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', b=require('crypto').randomBytes(20);
  let bits=0,v=0,o='';
  for (const x of b){v=(v<<8)|x;bits+=8;while(bits>=5){o+=a[(v>>>(bits-5))&31];bits-=5}}
  if(bits>0)o+=a[(v<<(5-bits))&31];
  console.log(o)
"

# One-liner that generates a fresh TOTP_SECRET and rewrites .env in place:
sed -i "s|^TOTP_SECRET=.*|TOTP_SECRET=$(head -c 20 /dev/urandom | base32 | tr -d '=')|" .env
```

> ⚠️ `TOTP_SECRET` **must** contain only `A–Z` and `2–7`. Lowercase
> letters, digits 0/1/8/9, dots, or any other characters break base32
> decoding — TOTP verification will reject every code and the QR will
> encode garbage. The `.env` is now read at runtime via `env_file:` (no
> longer baked into the image), so rotating any secret only needs:
> ```bash
> docker compose up -d        # picks up the edited .env, no rebuild
> ```
> Rotating `TOTP_SECRET` invalidates every prior registration — all
> operators have to scan a fresh QR.

### Login flow

1. SPA boots → `GET /api/auth/config` → renders the **anti-bot challenge**
   (5-character stylised SVG that uses the active theme's `currentColor`
   so it matches your chosen palette).
2. Solve the challenge → enter the **6-digit TOTP code**.
3. JWT is issued, kept **in memory + sessionStorage**, and silently
   refreshed every TTL/3.
4. Closing the tab drops the token (sessionStorage cleared) — automatic
   logout, no server-side session bookkeeping required.

### Anti-bot lockout

5 wrong captcha or TOTP answers from the same IP → **60-second lockout**
(HTTP 429 with `retryAfter`). The UI shows a live countdown.

### Hidden QR-reveal gate

On the login screen, press **`a` 12 times in a row** (focus outside
inputs and outside the open settings/QR panels). A master-password
field appears. Entering the correct `MASTER_PASSWORD` returns the
`otpauth://` URI; the SPA renders it as a **QR code locally** using the
active theme's foreground colour — the QR pixels never travel the wire.
Press **Esc** to close it and return to the login flow.

> **Why `a` and not `s`?** The in-app Super Mode trigger uses `s`
> twelve times (still works on the main UI). Keeping the two gates on
> different physical keys avoids accidental cross-firing.

This is how new operators onboard without anyone emailing the TOTP
secret around in plaintext: open the app, press 'a' 12 times, type the
master password, scan the QR with Google Authenticator / Microsoft
Authenticator / 1Password / any TOTP app.

### Share link

After a successful master-password reveal, the QR dialog grows a
**Reveal share link** button. Clicking it surfaces a one-shot URL of
the form `${URL_BASE}/?share=<salt>.<hmac>`:

- `salt` — 16 fresh random bytes (hex)
- `hmac` — HMAC-SHA256 of the salt, keyed by the **current**
  `MASTER_PASSWORD`

Anyone visiting that URL lands directly on a **QR-only view** (no
master-password field, no share button — they can't mint further
links). Pressing **Esc** or **✕** clears the `?share=` query string
in-place and falls through to the normal login screen, so the URL bar
ends up looking like a clean visit.

The validation is **stateless** — every issued share link contains
its own HMAC. Rotating `MASTER_PASSWORD` invalidates every previously
issued link instantly, because the recomputed HMAC stops matching. No
denylist or server-side state to manage.

### Routes summary (when AUTH_ENABLED=true)

| Route                     | Auth required | Notes |
|---------------------------|---------------|-------|
| `POST /api/callback/:id`  | ❌ Public     | Third-party services post here freely. |
| `GET /api/health`         | ❌ Public     | |
| `GET /api/auth/*`         | ❌ Public     | Captcha, login, config, QR reveal. |
| `POST /api/auth/refresh`  | 🔑 JWT        | Sliding-window renewal. |
| `*  /api/sessions/*`      | 🔑 JWT        | All session CRUD. |
| `WS  /socket.io`          | 🔑 JWT        | Token sent in handshake `auth` field. |
| `*  /api/admin/*`         | 🛂 Admin token + Origin filtering enabled | See below. |

---

## 🛡️ Origin filtering & Super Mode

Toggle with `ORIGIN_FILTERING_ENABLED` in `.env` (default `false`).

| Setting                       | Behaviour |
|-------------------------------|-----------|
| `ORIGIN_FILTERING_ENABLED=false` | Any browser origin is accepted. Super Mode is hidden completely from the UI; the admin endpoints return 403 with a clear reason. |
| `ORIGIN_FILTERING_ENABLED=true`  | Only origins listed in `UI_ORIGIN` are accepted, plus any added at runtime via Super Mode. The admin endpoints become reachable (token-gated). |

### Super Mode

When origin filtering is on, you can manage the allow list from inside
the SPA without restarting the container:

1. Open the inspector with no session selected.
2. Press **`s` 12 times in a row** (focus outside any input, outside
   the settings popover, outside the create-session dialog).
3. The settings popover opens with a **⚡ Super Mode** badge and an
   admin-token field.
4. Enter `ADMIN_TOKEN` from `.env` → token is validated against the
   backend → the full panel appears.
5. Add or remove origins. Origins seeded from `UI_ORIGIN` show a
   `🔒 .env` badge and **cannot be removed** at runtime; runtime-added
   ones get a delete button.

The unlock state persists in IndexedDB (the operator stays "in Super
Mode" across reloads), but the **admin token does not** — it lives only
in memory. Reload the page → re-enter the token. This contains the
blast radius of any future XSS or shared-machine snoop. Clear the IDB
to lock it again, or click "Exit Super Mode" inside the panel.

> Runtime-added origins live only in process memory — they're wiped on
> container restart. Permanent changes belong in `UI_ORIGIN`.

---

## ⚙️ Configuration

All configuration lives in `.env` (copy from `.env.example` first).

### Runtime
| Variable             | Default      | Notes |
|----------------------|--------------|-------|
| `NODE_ENV`           | `production` |       |
| `PORT`               | `3900`       | Backend listening port (internal) |
| `LOG_LEVEL`          | `info`       |       |
| `MAX_PAYLOAD_SIZE`   | `50mb`       | After gzip/deflate inflation |
| `TRUST_PROXY`        | `172.16.0.0/12,127.0.0.1,::1` | CSV of CIDRs of every proxy hop. Never set to `true`/`*` — the bootstrap warns and downgrades to loopback only. |

### Sessions
| Variable                       | Default                  | Notes |
|--------------------------------|--------------------------|-------|
| `SQLITE_PATH`                  | `/app/data/sessions.db`  | SQLite file the backend uses to persist session metadata. Mounted on the `ai-callback-data` Docker volume by default. |
| `SESSION_TTL_HOURS`            | `24`                     | Inactive-session expiry |
| `SESSION_FIRST_USE_GRACE_MIN`  | `60`                     | Grace window for sessions that never got their first callback |
| `MAX_SESSIONS`                 | `50000`                  |       |
| `MAX_CALLBACKS_PER_SESSION`    | `10000`                  |       |
| `MAX_BYTES_PER_SESSION`        | `209715200`              | 200 MB per session |

### CORS / origins
| Variable                    | Default | Notes |
|-----------------------------|---------|-------|
| `UI_ORIGIN`                 | `http://localhost:3901` | CSV of accepted browser origins |
| `URL_BASE`                  | `http://localhost:3901` | Canonical public URL of the SPA. The frontend builds every callback URL and share link from this — never trusts a value pulled from IndexedDB. Empty falls back to `window.location.origin`. |
| `ORIGIN_FILTERING_ENABLED`  | `false` | When false, any origin is accepted and Super Mode is hidden |
| `ADMIN_TOKEN`               | (empty) | Required by Super Mode when filtering is enabled |

### Login (TOTP)
| Variable             | Default              | Notes |
|----------------------|----------------------|-------|
| `AUTH_ENABLED`       | `false`              | Master switch for the login screen |
| `TOTP_SECRET`        | (empty)              | Base32, ≥16 chars |
| `MASTER_PASSWORD`    | (empty)              | Gates the in-app QR reveal |
| `TOTP_ISSUER`        | `AI Callback Explorer` |     |
| `TOTP_LABEL`         | `admin`              |       |
| `JWT_SECRET`         | (empty)              | Required when `AUTH_ENABLED=true` — `JwtModule.registerAsync` throws at boot if missing |
| `AUTH_TOKEN_TTL_SEC` | `900`                | 60–3600 |

### Frontend build (Vite)
| Variable             | Default        | Notes |
|----------------------|----------------|-------|
| `VITE_API_BASE_URL`  | (empty)        | Empty = same-origin |
| `VITE_WS_PATH`       | `/socket.io`   |       |

---

## 🌐 Exposing to the internet

Expose port `3901` through a reverse proxy with TLS. Ports `3900` and
`3901` themselves should remain bound to localhost.

If you turn on the login screen (`AUTH_ENABLED=true`), the IP allow
list in nginx becomes optional but still useful as defence in depth.

### Nginx example

```nginx
# /etc/nginx/conf.d/callback.yourdomain.com.conf

geo $callback_allowed {
    default          0;
    203.0.113.50/32  1;   # External service that POSTs callbacks
    198.51.100.10/32 1;   # Your personal IP
    192.168.1.0/24   1;   # Local network
    127.0.0.1/32     1;
    ::1              1;
}

server {
    listen 80;
    server_name callback.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name callback.yourdomain.com;

    ssl_certificate     /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    add_header Strict-Transport-Security
        "max-age=31536000; includeSubDomains" always;
    server_tokens off;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    client_max_body_size 50m;

    if ($callback_allowed = 0) { return 403; }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3901;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    location / {
        proxy_pass http://127.0.0.1:3901;
        proxy_http_version 1.1;
        proxy_buffering         off;
        proxy_request_buffering off;
        proxy_read_timeout  120s;
        proxy_send_timeout  120s;
    }
}
```

When putting the app on the public internet, the safest configuration
is `AUTH_ENABLED=true` + `ORIGIN_FILTERING_ENABLED=true` together with
the nginx geo block above.

---

## 🔒 Security model

```
Layer 1 — Network (router / firewall / Cloudflare)
  IP allowlist; only trusted IPs reach port 443.

Layer 2 — Reverse proxy (Nginx geo block)
  Redundant IP check; returns 403 for unknown IPs.

Layer 3 — Login (when AUTH_ENABLED=true)
  • Anti-bot captcha: stylised SVG, single-use, IP-tracked.
  • TOTP: shared base32 secret, 6 digits, 30s step, ±1 window.
  • 5 wrong answers (captcha + TOTP combined) → 60-second IP lockout.
  • JWT: HS256, 15-minute default TTL, sliding refresh.
  • Token in memory + sessionStorage (closing the tab logs out).
  • WebSocket handshake validates JWT.

Layer 4 — Application
  • Session IDs: UUID v4 (3.4 × 10³⁸ possible values).
  • Sessions expire after SESSION_TTL_HOURS of inactivity.
  • Per-IP rate limiting on every endpoint (app-layer + nginx
    limit_req_zone for /api/ and /api/callback/*).
  • Helmet headers (strict CSP `connect-src 'self'`, HSTS, no
    referrer, frame-deny).
  • Payload size capped (default 50 MB after inflation).
  • Callback endpoint always returns {received:true} (no oracle).
  • Admin endpoints: constant-time token comparison + filtering guard.
  • Trust-proxy-aware client-IP resolution: CF-Connecting-IP /
    X-Real-IP only consumed when the immediate TCP peer is in
    TRUST_PROXY (defeats header spoofing).

Layer 5 — Container
  • read_only root filesystem (writes go only to declared tmpfs +
    the named SQLite volume).
  • cap_drop: ALL + no-new-privileges:true.
  • Non-root users: nestjs (uid 1001) for backend, nginx (uid 101)
    for frontend, master process included.
  • Frontend nginx listens on internal 8080 (no NET_BIND_SERVICE
    needed); host loopback maps to 127.0.0.1:3901.
  • Lockfiles enforced strictly via `npm ci --ignore-scripts` in
    both Dockerfiles — postinstall scripts on transitive deps are
    contained (only known-native modules get explicit `npm rebuild`).
  • Secrets injected at runtime via env_file: in compose, never
    baked into images.

Layer 6 — Transport
  • HTTPS / WSS terminated at the reverse proxy.
  • HSTS enforced, max-age=2y, includeSubDomains, preload.
```

---

## 🛠️ Local development

### With the build helper (no Node.js on the host required)

```bash
./build.sh                # installs deps + lockfiles in backend/ and frontend/
./build.sh shell          # interactive shell inside the helper image
```

This is the recommended path: every npm operation runs inside a
Dockerised helper (`Dockerfile.build`) launched with `--rm`, so the host
never sees an `npm` binary or a `~/.npm` cache.

### With Node.js installed on the host

```bash
# Backend
cd backend
npm install --ignore-scripts
npm rebuild better-sqlite3
npm run start:dev    # http://localhost:3900

# Frontend
cd frontend
npm install --ignore-scripts
npm rebuild esbuild
npm run dev          # http://localhost:5173
# /api and /socket.io are proxied to localhost:3900 (vite.config.ts)
```

The backend reads `.env` from the project root via `node --env-file`
in dev mode (in production, `env_file:` in compose injects them as
container env vars).

---

## 📁 Project structure

```
ai-callback-explorer/
├── docker-compose.yml                       # read_only, cap_drop, tmpfs hardening
├── .env / .env.example                      # env_file: into backend at runtime
├── Dockerfile.build                         # build.sh helper image
├── build.sh                                 # ./build.sh {install|build|lockfile|shell|clean}
│
├── backend/                                 # NestJS application
│   ├── Dockerfile                           # Adds python3/make/g++ for
│   │                                        #   better-sqlite3 prebuild
│   ├── package.json                         # +otplib, +@nestjs/jwt,
│   │                                        # +better-sqlite3
│   └── src/
│       ├── main.ts                          # Bootstrap, Helmet, CORS
│       ├── app.module.ts
│       │
│       ├── auth/                            # Login & TOTP
│       │   ├── auth.module.ts
│       │   ├── auth.controller.ts           # /api/auth/* (config now
│       │   │                                #   exposes sessionTtlHours)
│       │   ├── auth.service.ts              # TOTP + JWT issue/verify
│       │   ├── captcha.service.ts           # Homemade SVG anti-bot
│       │   ├── jwt-auth.guard.ts
│       │   └── dto/
│       │       ├── captcha-solve.dto.ts
│       │       ├── login.dto.ts
│       │       └── qr-reveal.dto.ts
│       │
│       ├── admin/                           # Runtime CORS allow list
│       │   ├── admin.module.ts
│       │   ├── admin.controller.ts          # /api/admin/origins
│       │   ├── admin-token.guard.ts
│       │   ├── origin-filtering.guard.ts    # Refuses when flag is off
│       │   ├── allowed-origins.service.ts
│       │   ├── allowed-origins.state.ts     # Module-level Set + flag
│       │   └── dto/
│       │       ├── add-origin.dto.ts
│       │       └── remove-origin.dto.ts
│       │
│       ├── callback/
│       │   ├── callback.controller.ts       # Public — receives POSTs
│       │   ├── callback.gateway.ts          # Socket.IO + JWT handshake
│       │   ├── callback.service.ts
│       │   └── callback.module.ts
│       │
│       ├── session/
│       │   ├── session.controller.ts        # JWT-gated CRUD
│       │   ├── session.service.ts           # Write-through cache,
│       │   │                                #   boot-time cleanup
│       │   ├── session.repository.ts        # SQLite (better-sqlite3)
│       │   └── session.module.ts
│       │
│       └── common/
│           ├── filters/                     # Global exception filter
│           ├── interceptors/                # HTTP request logging
│           ├── middleware/                  # Security headers
│           └── util/
│
└── frontend/                                # Vue 3 + Pinia SPA
    ├── Dockerfile
    ├── nginx.conf                           # Internal reverse proxy
    ├── package.json                         # +vue-i18n, +qrcode
    └── src/
        ├── main.ts
        ├── App.vue                          # Auth gate + WS lifecycle
        │                                    #   (defensive bootstrap:
        │                                    #   ws.onCallback fires
        │                                    #   before any awaited
        │                                    #   hydrate)
        │
        ├── i18n/
        │   ├── index.ts                     # createI18n + locale list
        │   └── locales/                     # 8 locales:
        │       ├── en.ts                    #   English (default)
        │       ├── en-GB.ts                 #   English (UK)
        │       ├── pt-BR.ts                 #   Português (Brasil)
        │       ├── pt-PT.ts                 #   Português (Portugal)
        │       ├── es-ES.ts                 #   Español (España)
        │       ├── fr.ts                    #   Français
        │       ├── ca.ts                    #   Català
        │       └── de.ts                    #   Deutsch
        │
        ├── themes/
        │   └── index.ts                     # 22 themes + applyTheme()
        │
        ├── terminal/                        # TUI mode
        │   ├── TerminalView.vue             # Prompt + history + modes
        │   ├── TerminalNode.vue             # Rich-node renderer
        │   ├── SessionView.vue              # Easy-SQL-style list+detail
        │   ├── TuiPicker.vue                # Language/theme picker
        │   ├── shell.ts                     # Pipeline runner, autocomplete
        │   ├── commands.ts                  # Every shell command
        │   ├── fs.ts                        # Slug → session map
        │   ├── themes.ts                    # 5 TUI palettes
        │   └── types.ts                     # Command/Stdio/RichNode
        │
        ├── stores/
        │   ├── auth.ts                      # JWT + captcha + refresh
        │   ├── settings.ts                  # Theme/locale + view-mode
        │   ├── superMode.ts                 # 12-press unlock + admin
        │   └── sessions.ts                  # Cache + serverStatus
        │
        ├── composables/
        │   ├── useIndexedDB.ts              # Local persistent storage
        │   └── useWebSocket.ts              # Socket.IO + JWT handshake
        │
        ├── components/
        │   ├── LoginScreen.vue              # Captcha → TOTP card
        │   ├── CaptchaChallenge.vue         # Themed SVG widget
        │   ├── QrRevealDialog.vue           # Master-password → QR
        │   ├── SettingsMenu.vue             # Gear popover (lang/theme/
        │   │                                #   view/super)
        │   ├── SessionSidebar.vue           # Renders live/expired/
        │   │                                #   orphaned states
        │   ├── SessionPanel.vue             # Centre panel — entry list
        │   ├── CallbackDetail.vue           # Right panel — payload viewer
        │   ├── CallbackEntry.vue            # Single entry row
        │   ├── JsonViewer.vue               # Collapsible tree viewer
        │   ├── CreateSessionDialog.vue
        │   └── EmptyState.vue
        │
        ├── types/index.ts
        └── utils/
            ├── formatters.ts                # Locale-aware date/time
            │                                #   (incl. DD/MM/YYYY:HH:MM:SS)
            ├── callback-url.ts              # buildCallbackUrl()
            └── session-status.ts            # live/expired/orphaned label
```

---

## 🔑 Persistence at a glance

| What                                  | Where                                  | Cleared by |
|---------------------------------------|----------------------------------------|------------|
| Session metadata (server-side)        | SQLite `/app/data/sessions.db` (volume `ai-callback-data`) | TTL expiry (boot + 10-min sweep), `DELETE /api/sessions/:id`, or wiping the volume |
| Sessions list (client cache)          | IndexedDB `sessions`                   | "Clear all" button (cascades to the server) or wiping IDB |
| Callback payloads                     | IndexedDB `entries`                    | "Clear all", per-entry delete, or wiping IDB |
| Theme + locale                        | IndexedDB `settings`                   | Wiping IDB |
| Super Mode unlock state               | IndexedDB `settings`                   | "Exit Super Mode" button or wiping IDB |
| Super Mode admin token                | **Memory only** (Pinia state)          | Page reload — operator re-enters every time |
| JWT (when `AUTH_ENABLED=true`)        | sessionStorage                         | Closing the tab, manual logout |

The "Clear all" sidebar button now batch-deletes server-side too, so
IDB and SQLite stay in lock-step. The boot-time SQLite cleanup
guarantees the in-memory cache only ever contains live rows.

> **Note:** the IDB schema is at **version 2**. Existing browsers
> upgrade automatically — sessions and entries are preserved; the new
> `settings` store is added on first load.

---

## 🐳 Docker reference

```bash
docker compose up -d --build              # Build & start in background
docker compose up -d                      # After editing .env (no rebuild!)
docker compose logs -f                    # Stream all logs
docker compose logs -f backend            # Single service
docker compose restart backend            # Restart without rebuilding
docker compose down                       # Stop (preserves images and the
                                          #  ai-callback-data volume)
docker compose down --rmi local           # Stop + remove local images
                                          #  (volume still preserved)
docker stats ai-callback-backend ai-callback-frontend

# Inspect / wipe the SQLite session store:
docker volume inspect ai-callback-explorer_ai-callback-data
docker volume rm ai-callback-explorer_ai-callback-data   # nuke all sessions

# Build helper (no Node.js needed on host):
./build.sh lockfile                       # Regenerate package-lock.json
./build.sh                                # Install deps + lockfiles
./build.sh build                          # install + npm run build
./build.sh shell                          # Drop into the helper container
./build.sh clean                          # Wipe node_modules/, dist/, cache
```

---

## 🤝 Contributing

1. Fork
2. Branch:
   ```bash
   git checkout -b feat/your-feature
   ```
3. Commit using
   [Conventional Commits](https://www.conventionalcommits.org/):
   ```bash
   git commit -m "feat: add your feature"
   ```
4. Push and open a PR against `main`

TypeScript strict mode is enabled on both projects. All type errors
must be resolved before a PR is merged. New user-facing strings must be
added to **all 8 locales**.

---

## 📄 Licence

Licensed under the **Apache License 2.0** — see [LICENSE](LICENSE) for the
full text.

```
Copyright 2026 easantos

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
```
