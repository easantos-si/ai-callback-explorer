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
COPY backend/package-lock.json* ./

# Sync the lockfile with package.json (no install, no scripts), then
# install deterministically with `npm ci`. This makes the build robust to
# a stale package-lock.json without losing reproducibility.
RUN npm install --package-lock-only --ignore-scripts \
 && npm ci --ignore-scripts

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
COPY backend/package-lock.json* ./

# better-sqlite3 ships prebuilt binaries via node-gyp-build. Most
# alpine-x64 / arm64 hosts pick up the prebuild without any C++
# toolchain, but we add python3+make+g++ as a virtual package so the
# install survives even on platforms without a matching prebuild
# (e.g. fresh CPU arches). The build deps are uninstalled in the same
# RUN layer so they don't bloat the final image.
RUN apk add --no-cache --virtual .build-deps python3 make g++ && \
    npm install --package-lock-only --ignore-scripts && \
    npm ci --omit=dev && \
    npm cache clean --force && \
    apk del .build-deps

COPY --from=builder /app/dist ./dist

# Bake the project-root `.env` into the image. Node loads it at startup via
# `--env-file=.env`. Changing the file on disk has no effect on a running
# container — `docker-compose build` is required to pick up changes.
COPY .env ./.env

# /app/data is the SQLite home (controlled by SQLITE_PATH). Created
# here so a Docker volume mount inherits the right ownership without
# the operator having to chown anything by hand.
RUN mkdir -p /app/data && \
    chown -R nestjs:nodejs /app && \
    chmod 0440 /app/.env

USER nestjs

EXPOSE 3900

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "--env-file=.env", "dist/main.js"]
