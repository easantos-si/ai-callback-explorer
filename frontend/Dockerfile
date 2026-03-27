# ============================================
# Stage 1: Build Vue app
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

ARG VITE_API_BASE_URL=
ARG VITE_WS_PATH=/socket.io

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_WS_PATH=${VITE_WS_PATH}

# Install dependencies
COPY package.json ./
COPY package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci; \
    else \
      npm install; \
    fi

# Copy source + config
COPY tsconfig.json tsconfig.node.json vite.config.ts env.d.ts ./
COPY index.html ./
COPY src/ ./src/

# Build
RUN npm run build

# Verify dist
RUN test -f dist/index.html || (echo "Frontend build failed" && exit 1)

# ============================================
# Stage 2: Serve with nginx
# ============================================
FROM nginx:1.27-alpine

# Remove default config
RUN rm -f /etc/nginx/conf.d/default.conf

# Copy built app
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Create required directories with correct permissions
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown nginx:nginx /var/run/nginx.pid

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
