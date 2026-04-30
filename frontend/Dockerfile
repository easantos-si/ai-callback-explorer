# ============================================
# Build context: project root (see docker-compose.yml).
# All COPY paths therefore start with `frontend/...`.
# ============================================
# Stage 1: Build Vue app
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# These ARGs are populated by docker-compose from the root `.env` via
# ${VAR} interpolation. They become ENV during the Vite build, get baked
# into the static bundle, and have no presence in the runtime image.
ARG VITE_API_BASE_URL=
ARG VITE_WS_PATH=/socket.io

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_WS_PATH=${VITE_WS_PATH}

# Quiet npm: suppress the "new major version available" notice, the
# funding nag, and audit chatter during install. Purely cosmetic.
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

COPY frontend/package.json ./
COPY frontend/package-lock.json ./

# Strict reproducible install. We ignore postinstall scripts on the whole
# transitive tree to contain a compromised dep, then run only the install
# scripts that legitimately need to fetch native binaries (esbuild).
# `npm rebuild esbuild` re-runs that single package's install script.
# Add other native modules' rebuild commands here if introduced later.
RUN npm ci --ignore-scripts && \
    npm rebuild esbuild

COPY frontend/tsconfig.json frontend/tsconfig.node.json frontend/vite.config.ts frontend/env.d.ts ./
COPY frontend/index.html ./
COPY frontend/src/ ./src/

RUN npm run build

RUN test -f dist/index.html || (echo "Frontend build failed" && exit 1)

# ============================================
# Stage 2: Serve with nginx
# ============================================
FROM nginx:1.27-alpine

RUN rm -f /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Drop the master process from root → nginx user. The default alpine
# image keeps master as root and only drops workers; running both as
# nginx narrows the blast radius of any future nginx CVE. Listening on
# 8080 (>1024) avoids needing CAP_NET_BIND_SERVICE; docker-compose maps
# host port 3901 → container 8080.
#
# We also drop the `user nginx;` directive from /etc/nginx/nginx.conf
# because it triggers a setuid attempt at startup that fails when the
# master is already nginx (and even logs a confusing "ignored" warning
# without our cap_drop). The remaining workers inherit the master's uid.
#
# The official entrypoint helpers in /docker-entrypoint.d/ run sed -i on
# /etc/nginx/nginx.conf to tune worker_processes and envsubst on
# templates — both fail under read_only: true in compose. Our config is
# fully baked at build time; remove the helpers entirely so the image's
# /docker-entrypoint.sh exits early without trying to mutate config.
RUN sed -i '/^user /d' /etc/nginx/nginx.conf && \
    rm -rf /docker-entrypoint.d && \
    chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD wget -qO- http://127.0.0.1:8080/health >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
