# ============================================
# Stage 1: Install dependencies + build
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json ./
COPY package-lock.json* ./

# Install all deps (including dev for building)
RUN if [ -f package-lock.json ]; then \
      npm ci --ignore-scripts; \
    else \
      npm install --ignore-scripts; \
    fi

# Copy config files
COPY tsconfig.json tsconfig.build.json nest-cli.json ./

# Copy source — this layer is rebuilt when src changes
# The volume mount in docker-compose is :ro for dev reference,
# but the build always uses the COPY'd version
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Verify dist exists
RUN test -f dist/main.js || (echo "Build failed: dist/main.js not found" && exit 1)

# ============================================
# Stage 2: Production image
# ============================================
FROM node:20-alpine AS production

# Security: non-root user + minimal packages
RUN apk add --no-cache dumb-init && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

WORKDIR /app

# Install production deps only
COPY package.json ./
COPY package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --ignore-scripts; \
    else \
      npm install --omit=dev --ignore-scripts; \
    fi && \
    npm cache clean --force

# Copy built output
COPY --from=builder /app/dist ./dist

# Set ownership
RUN chown -R nestjs:nodejs /app

USER nestjs

EXPOSE 3900

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
