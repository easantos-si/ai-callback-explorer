# 🔬 AI Callback Explorer

A lightweight, real-time webhook inspector built with **NestJS** and
**Vue 3**. It receives HTTP callbacks from any external service and
displays the payloads instantly in the browser via WebSocket —
no page refresh required.

Each session generates a unique callback URL. Share that URL as the
`callback_url` (or equivalent) parameter in any service that supports
webhook delivery on job completion.

---

## ✨ Features

- 📡 **Real-time delivery** — payloads appear instantly via WebSocket
- 🗂️ **Session-based isolation** — each session has its own callback
  URL; multiple sessions run simultaneously without interference
- 🧠 **IndexedDB storage** — all data is stored locally in the
  browser; no database required on the server
- 🌲 **Interactive JSON viewer** — collapsible tree view for any
  payload shape, with raw and formatted modes
- 📋 **One-click copy** — copy the callback URL or any payload to
  the clipboard instantly
- 🔒 **Secure by design** — UUID v4 session IDs, TTL expiry, rate
  limiting, Helmet headers, and IP filtering support
- 🐳 **Docker-first** — a single `docker-compose up --build` runs
  everything

---

## 🏗️ Architecture

```
INTERNET
    │  HTTPS (443) + WSS
    ▼
┌──────────────────────────────────────────────┐
│  Reverse Proxy (Nginx / Caddy / Traefik)     │
│  callback.yourdomain.com → localhost:3901    │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│  Docker Network: ai-callback-network         │
│                                              │
│  ┌─────────────────────────────────────┐     │
│  │  frontend (nginx)  :3901            │     │
│  │  • Serves Vue 3 SPA                 │     │
│  │  • Proxies /api/*    → backend:3900 │     │
│  │  • Proxies /socket.io/ → backend    │     │
│  └────────────────┬────────────────────┘     │
│                   │ internal network          │
│  ┌────────────────▼────────────────────┐     │
│  │  backend (NestJS)  :3900            │     │
│  │  • REST API (sessions, callbacks)   │     │
│  │  • Socket.IO gateway                │     │
│  │  • In-memory session store + TTL    │     │
│  └─────────────────────────────────────┘     │
└──────────────────────────────────────────────┘

Browser (IndexedDB)
  • Sessions list
  • All callback payloads
  • Persists across page reloads
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

---

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/ai-callback-explorer.git
cd ai-callback-explorer
```

---

### 2. Generate lock files

Lock files are not committed to this repository. Generate them once
before the first build:

```bash
# Backend
docker run --rm \
  -v "$(pwd)/backend":/app \
  -w /app \
  node:20-alpine \
  npm install --package-lock-only

# Frontend
docker run --rm \
  -v "$(pwd)/frontend":/app \
  -w /app \
  node:20-alpine \
  npm install --package-lock-only
```

Verify both files were created:

```bash
ls -lh backend/package-lock.json frontend/package-lock.json
```

---

### 3. Build and start

```bash
docker-compose up -d --build
```

The first build takes **2–4 minutes** whilst Docker:

1. Pulls `node:20-alpine` and `nginx:1.27-alpine`
2. Installs all dependencies inside the containers
3. Compiles TypeScript (backend) and runs Vite (frontend)
4. Produces slim production images
5. Starts both containers and waits for the backend health check

Subsequent builds are significantly faster thanks to Docker layer
caching.

---

### 4. Verify everything is running

```bash
# Check container status
docker-compose ps

# Expected output:
# NAME                    STATUS              PORTS
# ai-callback-backend     Up (healthy)        0.0.0.0:3900->3900/tcp
# ai-callback-frontend    Up                  0.0.0.0:3901->80/tcp

# Health check
curl -s http://localhost:3900/api/health
# {"status":"ok","timestamp":"...","uptime":...}
```

---

### 5. Open the app

```
http://localhost:3901
```

---

## 📖 Usage

### Creating a session

1. Click **+** in the left sidebar
2. Give the session a descriptive name
3. Click **Create Session**
4. A unique callback URL is generated:
   ```
   http://localhost:3901/api/callback/xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx
   ```
5. Copy the URL by clicking the 📋 icon beneath the session name

### Receiving a callback

Pass the callback URL as the webhook destination in any service that
supports HTTP callbacks on job completion. When the service POSTs its
result to that URL, the payload appears **instantly** in the session
panel.

### Simulating a callback

You can test the full flow without any external service:

```bash
# 1. Create a session via the UI and copy its ID, then:
SESSION_ID="paste-your-session-id-here"

curl -X POST "http://localhost:3901/api/callback/${SESSION_ID}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed",
    "message": "If this appears in the Explorer, everything is working."
  }'
```

The payload should appear in the browser within milliseconds.

---

## ⚙️ Configuration

All configuration is handled via environment variables in
`docker-compose.yml`. No `.env` file is required for a standard
local setup.

| Variable            | Default  | Description                                      |
|---------------------|----------|--------------------------------------------------|
| `PORT`              | `3900`   | Backend listening port                           |
| `CORS_ORIGIN`       | `*`      | Allowed CORS origins (comma-separated)           |
| `MAX_PAYLOAD_SIZE`  | `50mb`   | Maximum request body size                        |
| `RATE_LIMIT_TTL`    | `60`     | Rate-limit window in seconds                     |
| `RATE_LIMIT_MAX`    | `100`    | Maximum requests per window per IP               |
| `SESSION_TTL_HOURS` | `72`     | Hours before an inactive session expires         |
| `TRUST_PROXY`       | `true`   | Required when running behind a reverse proxy     |
| `NODE_ENV`          | `production` | Node environment                             |

---

## 🌐 Exposing to the Internet

To make callback URLs reachable by external services, expose port
`3901` through a reverse proxy with TLS.

> **Only ports 80 and 443 need to be open** on your router or
> firewall. Ports `3900` and `3901` must remain internal.

### Nginx example

```nginx
# /etc/nginx/conf.d/callback.yourdomain.com.conf

geo $callback_allowed {
    default          0;
    # External service IP (the one that will POST callbacks)
    203.0.113.50/32  1;
    # Your personal IP (to access the frontend)
    198.51.100.10/32 1;
    # Local network
    192.168.1.0/24   1;
    127.0.0.1/32     1;
    ::1              1;
}

server {
    listen 80;
    server_name callback.yourdomain.com;
    return 301 https://$$host$$request_uri;
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

    # Block any IP not listed in the geo block above
    if ($callback_allowed = 0) { return 403; }

    # WebSocket (Socket.IO)
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

    # All other traffic (API + SPA)
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

---

## 🔒 Security Model

```
Layer 1 — Network (router / firewall)
  IP allowlist: only trusted IPs reach port 443

Layer 2 — Reverse proxy (Nginx geo block)
  Redundant IP check; returns 403 for unknown IPs

Layer 3 — Application
  • Session IDs: UUID v4 (3.4 × 10³⁸ possible values)
  • Sessions expire after 72 h of inactivity (configurable)
  • Rate limiting on all endpoints
  • Helmet security headers on every response
  • Payload size capped (default 50 MB)
  • Callback endpoint always returns 200 to prevent
    information leakage to unknown callers

Layer 4 — Transport
  • All traffic encrypted via HTTPS / WSS
  • HSTS enforced
```

---

## 🛠️ Local Development (without Docker)

### Backend

```bash
cd backend
npm install
npm run start:dev
# Listening on http://localhost:3900
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# Listening on http://localhost:5173
# /api and /socket.io are proxied to localhost:3900 via vite.config.ts
```

---

## 📁 Project Structure

```
ai-callback-explorer/
├── docker-compose.yml
├── backend/                            # NestJS application
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── main.ts                     # Bootstrap, Helmet, CORS
│       ├── app.module.ts
│       ├── callback/
│       │   ├── callback.controller.ts  # Receives inbound POSTs
│       │   ├── callback.gateway.ts     # Socket.IO gateway
│       │   ├── callback.service.ts     # Entry builder / sanitiser
│       │   └── callback.module.ts
│       ├── session/
│       │   ├── session.controller.ts   # Session CRUD
│       │   ├── session.service.ts      # In-memory store + TTL
│       │   └── session.module.ts
│       └── common/
│           ├── filters/                # Global exception filter
│           ├── guards/                 # Rate-limit guard
│           ├── interceptors/           # HTTP request logging
│           └── middleware/             # Security headers
└── frontend/                           # Vue 3 + Pinia SPA
    ├── Dockerfile
    ├── nginx.conf                      # Internal reverse proxy
    └── src/
        ├── App.vue                     # Root layout + WS lifecycle
        ├── stores/sessions.ts          # Pinia store
        ├── composables/
        │   ├── useIndexedDB.ts         # Local persistent storage
        │   └── useWebSocket.ts         # Socket.IO client (singleton)
        ├── components/
        │   ├── SessionSidebar.vue      # Left panel — session list
        │   ├── SessionPanel.vue        # Centre panel — entry list
        │   ├── CallbackDetail.vue      # Right panel — payload viewer
        │   ├── CallbackEntry.vue       # Single entry row
        │   ├── JsonViewer.vue          # Collapsible tree viewer
        │   ├── CreateSessionDialog.vue
        │   └── EmptyState.vue
        ├── types/index.ts
        └── utils/formatters.ts
```

---

## 🐳 Docker Reference

```bash
# Build and start in detached mode
docker-compose up -d --build

# Stream logs (all services)
docker-compose logs -f

# Stream logs (single service)
docker-compose logs -f backend
docker-compose logs -f frontend

# Restart a single service without rebuilding
docker-compose restart backend

# Stop all containers (preserves images)
docker-compose down

# Stop and remove all local images (full clean)
docker-compose down --rmi local

# Monitor resource usage
docker stats ai-callback-backend ai-callback-frontend
```

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
   ```bash
   git checkout -b feat/your-feature
   ```
3. Commit your changes using
   [Conventional Commits](https://www.conventionalcommits.org/)
   ```bash
   git commit -m "feat: add your feature"
   ```
4. Push and open a Pull Request against `main`

TypeScript strict mode is enabled on both projects. All type errors
must be resolved before a PR can be merged.

---

## 📄 Licence

MIT — see [LICENSE](LICENSE) for details.
