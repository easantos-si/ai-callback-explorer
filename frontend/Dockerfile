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
COPY frontend/package-lock.json* ./

# Sync the lockfile with package.json, then install deterministically.
# Vite/Vue need install scripts to run (esbuild, etc.), so --ignore-scripts
# is intentionally NOT used here.
RUN npm install --package-lock-only \
 && npm ci

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

RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown nginx:nginx /var/run/nginx.pid

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
