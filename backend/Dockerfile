# ============================================
# Build context: project root (see docker-compose.yml).
# All COPY paths therefore start with `backend/...` (or `.env` at root).
# ============================================
# Stage 1: Install dependencies + build
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Quiet npm: suppress the "new major version available" notice, the
# funding nag, and audit chatter during install. Purely cosmetic — none
# of these affect the resulting bundle.
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

COPY backend/package.json ./
COPY backend/package-lock.json ./

# Strict reproducible install: lockfile MUST match package.json. If they
# diverge, npm ci fails — surfacing the drift immediately instead of
# silently regenerating the lockfile inside the image.
RUN npm ci --ignore-scripts

COPY backend/tsconfig.json backend/tsconfig.build.json backend/nest-cli.json ./
COPY backend/src/ ./src/

RUN npm run build

RUN test -f dist/main.js || (echo "Build failed: dist/main.js not found" && exit 1)

# ============================================
# Stage 2: Production image
# ============================================
FROM node:20-alpine AS production

ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

RUN apk add --no-cache dumb-init && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

WORKDIR /app

COPY backend/package.json ./
COPY backend/package-lock.json ./

# better-sqlite3 ships prebuilt binaries via node-gyp-build. Most
# alpine-x64 / arm64 hosts pick up the prebuild without any C++
# toolchain, but we add python3+make+g++ as a virtual package so the
# install survives even on platforms without a matching prebuild
# (e.g. fresh CPU arches). The build deps are uninstalled in the same
# RUN layer so they don't bloat the final image.
#
# We pass --ignore-scripts to neutralise postinstall scripts in the
# entire transitive tree (supply-chain defence, see 2026 worm campaigns)
# and run better-sqlite3's install explicitly afterwards via npm rebuild,
# since it legitimately needs to resolve a prebuilt binary (or compile
# from C++ when no prebuild matches the host arch).
RUN apk add --no-cache --virtual .build-deps python3 make g++ && \
    npm ci --omit=dev --ignore-scripts && \
    npm rebuild better-sqlite3 && \
    npm cache clean --force && \
    apk del .build-deps

COPY --from=builder /app/dist ./dist

# Secrets are NOT baked into the image. They flow in via env_file: in
# docker-compose.yml (or runtime `-e` / `--env-file` for plain docker run).
# This keeps the image stateless and re-distributable without leaking
# JWT_SECRET / TOTP_SECRET / ADMIN_TOKEN / MASTER_PASSWORD via image pulls,
# layer history, or registry mirrors.

# /app/data is the SQLite home (controlled by SQLITE_PATH). Created
# here so a Docker volume mount inherits the right ownership without
# the operator having to chown anything by hand.
RUN mkdir -p /app/data && \
    chown -R nestjs:nodejs /app

USER nestjs

EXPOSE 3900

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
